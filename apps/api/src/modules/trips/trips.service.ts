import { randomInt, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  ACTIVE_TRIP_STATUSES,
  AdminTripDetail,
  type AdminTripList,
  type AdminTripListQuery,
  type CancelledBy,
  type CreateTripRequest,
  DEFAULT_CURRENCY,
  type DriverEarnings,
  type DriverEarningsQuery,
  haversineMeters,
  type Trip as TripDto,
  type TripDriverLocation,
  type TripHistory,
  type TripHistoryQuery,
  type TripStatus,
  type UserRole,
} from '@rideapp/contracts';
import { ApiException } from '../../common/errors/api.exception.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { MAINTENANCE_QUEUE, QueueService } from '../../infra/queue/queue.service.js';
import { RedisService } from '../../infra/redis/redis.service.js';
import { colombiaDay } from '../geo/geo.service.js';
import { LocationService } from '../location/location.service.js';
import { PricingService } from '../pricing/pricing.service.js';
import { RealtimeGateway, tripRoom } from '../realtime/realtime.gateway.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { LiveTripService } from './live-trip.service.js';
import { MATCHING_TIMINGS, MatchingService, type MatchingTimings } from './matching.service.js';
import { RATING_WINDOW_MS, ratingAverage } from './ratings.service.js';
import { DRIVER_BUSY_STATUSES } from './trip-state.machine.js';
import { isUniqueViolation, TripTransitions } from './trip-transitions.js';

const FINISHED_STATUSES = ['COMPLETED', 'CANCELLED', 'NO_DRIVERS'] as const;
/** Estados en los que el pasajero puede cancelar (8.8). */
const PASSENGER_CANCELLABLE: readonly TripStatus[] = [
  'REQUESTED',
  'SEARCHING',
  'DRIVER_ASSIGNED',
  'DRIVER_ARRIVED',
];
const DRIVER_CANCELLABLE: readonly TripStatus[] = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVED'];
const isBusy = (status: TripStatus) =>
  (DRIVER_BUSY_STATUSES as readonly TripStatus[]).includes(status);

/** "Llegué" solo cerca de la recogida, para no avisar al pasajero en falso. */
export const ARRIVE_RADIUS_METERS = 300;
/** Iniciar solo a menos de ~150 m del origen (8.8, paso 4). */
export const START_RADIUS_METERS = 150;
/** Intentos de PIN por viaje: 4 dígitos no aguantan un ataque de fuerza bruta. */
export const MAX_PIN_ATTEMPTS = 5;
const pinAttemptsKey = (tripId: string) => `trip:${tripId}:pin-attempts`;

const ratingFields = { fullName: true, ratingSum: true, ratingCount: true } as const;

const tripInclude = {
  passenger: { select: ratingFields },
  driver: { select: { user: { select: ratingFields } } },
  vehicle: true,
  payment: true,
  ratings: { select: { fromUser: true, score: true, comment: true, createdAt: true } },
} satisfies Prisma.TripInclude;

type TripWithParties = Prisma.TripGetPayload<{ include: typeof tripInclude }>;

export interface Viewer {
  id: string;
  role: UserRole;
}

/** Historial: solo viajes que llegaron a algo (los NO_DRIVERS no aportan nada al usuario). */
const HISTORY_STATUSES = ['COMPLETED', 'CANCELLED'] as const;

/** El viaje tal como lo ve uno de sus participantes (14.4: cada parte ve solo lo suyo). */
export function toTripDto(
  trip: TripWithParties,
  viewer: 'PASSENGER' | 'DRIVER',
  viewerId: string | null,
  now = Date.now(),
): TripDto {
  const assigned = trip.driver !== null && trip.vehicle !== null;
  const myRating = trip.ratings.find((r) => r.fromUser === viewerId)?.score ?? null;
  const rateableUntil =
    trip.status === 'COMPLETED' && trip.completedAt && myRating === null && viewerId
      ? new Date(trip.completedAt.getTime() + RATING_WINDOW_MS)
      : null;
  return {
    id: trip.id,
    status: trip.status,
    category: trip.category,
    paymentMethod: trip.paymentMethod,
    origin: { lat: trip.originLat, lng: trip.originLng },
    destination: { lat: trip.destinationLat, lng: trip.destinationLng },
    originAddress: trip.originAddress,
    destinationAddress: trip.destinationAddress,
    amount: { amountCents: trip.finalAmountCents ?? trip.amountCents, currency: trip.currency },
    distanceMeters: trip.distanceM,
    durationSeconds: trip.durationS,
    polyline: trip.polyline,
    pin: viewer === 'PASSENGER' ? trip.pin : null,
    requestedAt: trip.requestedAt.toISOString(),
    acceptedAt: trip.acceptedAt?.toISOString() ?? null,
    arrivedAt: trip.arrivedAt?.toISOString() ?? null,
    startedAt: trip.startedAt?.toISOString() ?? null,
    completedAt: trip.completedAt?.toISOString() ?? null,
    cancelledAt: trip.cancelledAt?.toISOString() ?? null,
    cancelledBy: trip.cancelledBy,
    cancelReason: trip.cancelReason,
    driver:
      viewer === 'PASSENGER' && assigned
        ? {
            fullName: trip.driver!.user.fullName,
            rating: ratingAverage(trip.driver!.user.ratingSum, trip.driver!.user.ratingCount),
            vehicle: {
              plate: trip.vehicle!.plate,
              brand: trip.vehicle!.brand,
              model: trip.vehicle!.model,
              color: trip.vehicle!.color,
              category: trip.vehicle!.category,
            },
          }
        : null,
    passenger:
      viewer === 'DRIVER'
        ? {
            fullName: trip.passenger.fullName,
            rating: ratingAverage(trip.passenger.ratingSum, trip.passenger.ratingCount),
          }
        : null,
    payment: trip.payment
      ? {
          method: trip.payment.provider,
          status: trip.payment.status,
          amount: { amountCents: trip.payment.amountCents, currency: trip.payment.currency },
          paidAt: trip.payment.capturedAt?.toISOString() ?? null,
        }
      : null,
    myRating,
    rateableUntil:
      rateableUntil && rateableUntil.getTime() > now ? rateableUntil.toISOString() : null,
  };
}

/**
 * Viajes (8.8): pedir con una cotización, consultar, retomar y cancelar. La búsqueda de conductor
 * la hace MatchingService; los cambios de estado, TripTransitions.
 */
@Injectable()
export class TripsService implements OnModuleInit {
  private readonly logger = new Logger(TripsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly transitions: TripTransitions,
    private readonly matching: MatchingService,
    private readonly location: LocationService,
    private readonly realtime: RealtimeGateway,
    private readonly idempotency: IdempotencyService,
    private readonly queues: QueueService,
    private readonly live: LiveTripService,
    private readonly redis: RedisService,
    private readonly payments: PaymentsService,
    private readonly notifications: NotificationsService,
    @Inject(MATCHING_TIMINGS) private readonly timings: MatchingTimings,
  ) {}

  onModuleInit(): void {
    // Al conectar, cada socket entra en la sala de su viaje activo (8.10, paso 2).
    this.realtime.registerRoomResolver(async (user) => {
      const id = await this.activeTripId(user);
      return id ? [tripRoom(id)] : [];
    });
    this.queues.every(MAINTENANCE_QUEUE, 'stale-searches', 60_000, () => this.closeStaleSearches());
    this.queues.every(MAINTENANCE_QUEUE, 'expired-quotes', 3600_000, () =>
      this.pricing.purgeExpired(),
    );
  }

  /** POST /trips (8.8, paso 3): con `Idempotency-Key`, un reintento devuelve el mismo viaje. */
  create(
    passengerId: string,
    body: CreateTripRequest,
    idempotencyKey: string | undefined,
  ): Promise<TripDto> {
    return this.idempotency.run(
      'trips.create',
      passengerId,
      idempotencyKey,
      async () => {
        const trip = await this.request(passengerId, body);
        return { result: trip, ref: trip.id };
      },
      (tripId) => this.get({ id: passengerId, role: 'PASSENGER' }, tripId),
    );
  }

  private async request(passengerId: string, body: CreateTripRequest): Promise<TripDto> {
    const quote = await this.prisma.fareQuote.findUnique({ where: { id: body.quoteId } });
    // Una cotización ajena responde igual que una inexistente (sin pistas de IDOR).
    if (!quote || quote.passengerId !== passengerId) {
      throw new ApiException(404, 'NOT_FOUND', 'Cotización no encontrada');
    }
    if (quote.expiresAt.getTime() <= Date.now()) {
      throw new ApiException(409, 'QUOTE_EXPIRED', 'La cotización caducó. Vuelve a cotizar.');
    }
    await this.assertNoActiveTrip(passengerId);

    let tripId: string;
    try {
      tripId = await this.prisma.$transaction(async (tx) => {
        const trip = await tx.trip.create({
          data: {
            passengerId,
            quoteId: quote.id,
            category: quote.category,
            paymentMethod: body.paymentMethod,
            originLat: quote.originLat,
            originLng: quote.originLng,
            destinationLat: quote.destinationLat,
            destinationLng: quote.destinationLng,
            originAddress: quote.originAddress,
            destinationAddress: quote.destinationAddress,
            destinationPlaceId: quote.destinationPlaceId,
            distanceM: quote.distanceM,
            durationS: quote.durationS,
            polyline: quote.polyline,
            amountCents: quote.amountCents,
            currency: quote.currency,
            pin: String(randomInt(0, 10_000)).padStart(4, '0'),
          },
        });
        await tx.tripEvent.create({
          data: {
            tripId: trip.id,
            toStatus: 'REQUESTED',
            actor: 'PASSENGER',
            actorId: passengerId,
          },
        });
        return trip.id;
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Dos solicitudes a la vez: el índice único decide. ¿Fue el viaje activo o la cotización?
      await this.assertNoActiveTrip(passengerId);
      throw new ApiException(409, 'CONFLICT', 'Esta cotización ya se usó. Vuelve a cotizar.');
    }

    const searching = await this.transitions.transition({
      tripId,
      to: 'SEARCHING',
      actor: 'SYSTEM',
      actorId: null,
    });
    this.realtime.joinUser(passengerId, tripRoom(tripId));
    if (searching.ok) {
      this.transitions.publish(searching.trip, searching.from);
      await this.matching.search(tripId);
    }
    return this.get({ id: passengerId, role: 'PASSENGER' }, tripId);
  }

  /** GET /trips/:id: solo sus participantes. Un viaje ajeno responde 404 (IDOR, 8.1, paso 3). */
  async get(viewer: Viewer, tripId: string): Promise<TripDto> {
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId }, include: tripInclude });
    const role = trip && this.participantRole(trip, viewer);
    if (!trip || !role) throw new ApiException(404, 'NOT_FOUND', 'Viaje no encontrado');
    return toTripDto(trip, role, viewer.id);
  }

  /** GET /trips: historial propio, del más reciente al más antiguo (9.5, paso 3). */
  async history(viewer: Viewer, query: TripHistoryQuery): Promise<TripHistory> {
    const own = viewer.role === 'DRIVER' ? { driverId: viewer.id } : { passengerId: viewer.id };
    const rows = await this.prisma.trip.findMany({
      where: { ...own, status: { in: [...HISTORY_STATUSES] } },
      include: tripInclude,
      // uuid v7: ordenar por id es ordenar por fecha de creación.
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((t) => ({
        id: t.id,
        status: t.status,
        category: t.category,
        paymentMethod: t.paymentMethod,
        originAddress: t.originAddress,
        destinationAddress: t.destinationAddress,
        amount: { amountCents: t.finalAmountCents ?? t.amountCents, currency: t.currency },
        requestedAt: t.requestedAt.toISOString(),
        completedAt: t.completedAt?.toISOString() ?? null,
        counterpartName:
          viewer.role === 'DRIVER' ? t.passenger.fullName : (t.driver?.user.fullName ?? null),
        myRating: t.ratings.find((r) => r.fromUser === viewer.id)?.score ?? null,
      })),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /**
   * GET /drivers/me/earnings (10.4): suma de los viajes completados entre dos días de Colombia,
   * ambos incluidos. En la demo no hay liquidaciones: es solo informativo.
   */
  async earnings(driverId: string, query: DriverEarningsQuery): Promise<DriverEarnings> {
    // Colombia es UTC−5 todo el año (sin horario de verano).
    const from = new Date(`${query.from}T05:00:00.000Z`);
    const to = new Date(Date.parse(`${query.to}T05:00:00.000Z`) + 86_400_000);
    const [rows, user] = await Promise.all([
      this.prisma.$queryRaw<
        { day: string; method: 'CASH' | 'FAKE_CARD'; trips: number; amount: bigint }[]
      >`
        SELECT to_char(completed_at AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD') AS day,
               payment_method::text AS method,
               count(*)::int AS trips,
               sum(coalesce(final_amount_cents, amount_cents))::bigint AS amount
        FROM trips
        WHERE driver_id = ${driverId}::uuid AND status = 'COMPLETED'
          AND completed_at >= ${from} AND completed_at < ${to}
        GROUP BY 1, 2
        ORDER BY 1`,
      this.prisma.user.findUniqueOrThrow({
        where: { id: driverId },
        select: { ratingSum: true, ratingCount: true },
      }),
    ]);

    const days = new Map<string, { date: string; trips: number; amountCents: number }>();
    let cash = 0;
    let card = 0;
    let trips = 0;
    for (const row of rows) {
      const amount = Number(row.amount);
      const day = days.get(row.day) ?? { date: row.day, trips: 0, amountCents: 0 };
      day.trips += row.trips;
      day.amountCents += amount;
      days.set(row.day, day);
      trips += row.trips;
      if (row.method === 'CASH') cash += amount;
      else card += amount;
    }
    const money = (amountCents: number) => ({ amountCents, currency: DEFAULT_CURRENCY });
    return {
      from: query.from,
      to: query.to,
      trips,
      total: money(cash + card),
      cash: money(cash),
      card: money(card),
      days: [...days.values()],
      rating: {
        average: ratingAverage(user.ratingSum, user.ratingCount),
        count: user.ratingCount,
      },
    };
  }

  /** GET /trips/active: el viaje en curso del usuario, para retomarlo (8.8, paso 3). */
  async active(viewer: Viewer): Promise<TripDto | null> {
    const id = await this.activeTripId(viewer);
    return id ? this.get(viewer, id) : null;
  }

  async cancel(viewer: Viewer, tripId: string, reason?: string): Promise<TripDto> {
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId } });
    const role = trip && this.participantRole(trip, viewer);
    if (!trip || !role) throw new ApiException(404, 'NOT_FOUND', 'Viaje no encontrado');

    const result = await this.transitions.transition({
      tripId,
      from: role === 'PASSENGER' ? PASSENGER_CANCELLABLE : DRIVER_CANCELLABLE,
      to: 'CANCELLED',
      actor: role,
      actorId: viewer.id,
      data: {
        cancelledAt: new Date(),
        cancelledBy: role satisfies CancelledBy,
        cancelReason: reason ?? null,
      },
    });
    if (!result.ok) {
      throw new ApiException(409, 'CONFLICT', 'Este viaje ya no se puede cancelar.');
    }
    await this.afterEnd(result.trip.id, result.from, result.trip.driverId);
    this.transitions.publish(result.trip, result.from);
    // Avisar a la otra parte, si la había (8.13).
    if (result.trip.driverId) {
      const [to, template] =
        role === 'PASSENGER'
          ? ([result.trip.driverId, 'trip.cancelled_by_passenger'] as const)
          : ([result.trip.passengerId, 'trip.cancelled_by_driver'] as const);
      await this.notifications.push(to, template, { type: 'trip.status', tripId });
    }
    return this.get(viewer, tripId);
  }

  /** El conductor acepta la oferta (8.9, paso 7). */
  async accept(driverId: string, tripId: string): Promise<TripDto> {
    const trip = await this.matching.accept(driverId, tripId);
    await this.live.onAssigned(trip);
    return this.get({ id: driverId, role: 'DRIVER' }, tripId);
  }

  /** "Llegué" (10.3, paso 4): el conductor está en el punto de recogida. */
  async arrived(driverId: string, tripId: string): Promise<TripDto> {
    const trip = await this.assertDriverOf(driverId, tripId);
    if (trip.status !== 'DRIVER_ASSIGNED') {
      throw new ApiException(409, 'CONFLICT', 'El viaje ya no está esperando tu llegada.');
    }
    await this.assertNearPickup(driverId, trip, ARRIVE_RADIUS_METERS);
    const result = await this.transitions.transition({
      tripId,
      from: ['DRIVER_ASSIGNED'],
      to: 'DRIVER_ARRIVED',
      actor: 'DRIVER',
      actorId: driverId,
      data: { arrivedAt: new Date() },
    });
    if (!result.ok) {
      throw new ApiException(409, 'CONFLICT', 'El viaje ya no está esperando tu llegada.');
    }
    await this.live.onArrived(tripId);
    this.transitions.publish(result.trip, result.from);
    await this.notifications.push(result.trip.passengerId, 'trip.arrived', {
      type: 'trip.status',
      tripId,
    });
    return this.get({ id: driverId, role: 'DRIVER' }, tripId);
  }

  /**
   * Iniciar (8.8, paso 4): solo cerca del origen y con el PIN que dicta el pasajero. Los intentos
   * fallidos se cuentan por viaje.
   */
  async start(driverId: string, tripId: string, pin: string): Promise<TripDto> {
    const trip = await this.assertDriverOf(driverId, tripId);
    if (trip.status !== 'DRIVER_ARRIVED') {
      throw new ApiException(409, 'CONFLICT', 'Marca primero que llegaste a la recogida.');
    }
    await this.assertNearPickup(driverId, trip, START_RADIUS_METERS);

    const attempts = await this.redis.client
      .multi()
      .incr(pinAttemptsKey(tripId))
      .expire(pinAttemptsKey(tripId), 6 * 3600, 'NX')
      .exec();
    if (Number(attempts?.[0]?.[1] ?? 0) > MAX_PIN_ATTEMPTS) {
      throw new ApiException(
        429,
        'RATE_LIMITED',
        'Demasiados intentos con el PIN. Si no coincide, cancela el viaje.',
      );
    }
    if (!timingSafeEqual(Buffer.from(pin), Buffer.from(trip.pin))) {
      throw new ApiException(
        422,
        'INVALID_PIN',
        'El PIN no coincide. Pídeselo de nuevo al pasajero.',
      );
    }

    const result = await this.transitions.transition({
      tripId,
      from: ['DRIVER_ARRIVED'],
      to: 'IN_PROGRESS',
      actor: 'DRIVER',
      actorId: driverId,
      data: { startedAt: new Date() },
    });
    if (!result.ok) throw new ApiException(409, 'CONFLICT', 'Este viaje ya no se puede iniciar.');
    await this.redis.client.del(pinAttemptsKey(tripId));
    await this.live.onStarted(result.trip);
    this.transitions.publish(result.trip, result.from);
    return this.get({ id: driverId, role: 'DRIVER' }, tripId);
  }

  /**
   * Finalizar (8.8): precio cerrado, el final es el cotizado (8.7, paso 4). Con `Idempotency-Key`,
   * un reintento por mala conexión devuelve el mismo viaje en vez de un 409.
   */
  complete(driverId: string, tripId: string, idempotencyKey: string | undefined): Promise<TripDto> {
    const viewer: Viewer = { id: driverId, role: 'DRIVER' };
    return this.idempotency.run(
      'trips.complete',
      driverId,
      idempotencyKey,
      async () => {
        const trip = await this.assertDriverOf(driverId, tripId);
        const result = await this.transitions.transition({
          tripId,
          from: ['IN_PROGRESS'],
          to: 'COMPLETED',
          actor: 'DRIVER',
          actorId: driverId,
          data: { completedAt: new Date(), finalAmountCents: trip.amountCents },
        });
        if (!result.ok) throw new ApiException(409, 'CONFLICT', 'Este viaje no está en curso.');
        await this.afterEnd(tripId, result.from, driverId);
        await this.payments.settle(result.trip);
        this.transitions.publish(result.trip, result.from);
        return { result: await this.get(viewer, tripId), ref: tripId };
      },
      (ref) => this.get(viewer, ref),
    );
  }

  /**
   * GET /trips/:id/driver-location: última posición del conductor, solo para el pasajero y solo
   * mientras el viaje está activo con conductor (14.4).
   */
  async driverLocation(viewer: Viewer, tripId: string): Promise<TripDriverLocation | null> {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: { passengerId: true, driverId: true, status: true },
    });
    if (!trip || this.participantRole(trip, viewer) !== 'PASSENGER') {
      throw new ApiException(404, 'NOT_FOUND', 'Viaje no encontrado');
    }
    return isBusy(trip.status) ? this.live.live(tripId) : null;
  }

  // -------------------------------------------------------------------------------------
  // Panel admin (11.1, paso 7)
  // -------------------------------------------------------------------------------------

  async adminList(query: AdminTripListQuery): Promise<AdminTripList> {
    const status =
      query.status === 'ACTIVE'
        ? { in: [...ACTIVE_TRIP_STATUSES] }
        : query.status === 'FINISHED'
          ? { in: [...FINISHED_STATUSES] }
          : query.status;
    const rows = await this.prisma.trip.findMany({
      where: status ? { status } : {},
      include: tripInclude,
      // uuid v7: ordenar por id es ordenar por fecha de creación.
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((t) => ({
        id: t.id,
        status: t.status,
        category: t.category,
        passengerName: t.passenger.fullName,
        driverName: t.driver?.user.fullName ?? null,
        originAddress: t.originAddress,
        destinationAddress: t.destinationAddress,
        amount: { amountCents: t.finalAmountCents ?? t.amountCents, currency: t.currency },
        requestedAt: t.requestedAt.toISOString(),
      })),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async adminDetail(tripId: string): Promise<AdminTripDetail> {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: { ...tripInclude, events: { orderBy: { at: 'asc' } } },
    });
    if (!trip) throw new ApiException(404, 'NOT_FOUND', 'Viaje no encontrado');
    // parse() descarta lo que el panel no debe ver (el PIN del pasajero).
    return AdminTripDetail.parse({
      ...toTripDto(trip, 'DRIVER', null),
      passenger: { id: trip.passengerId, fullName: trip.passenger.fullName },
      driver:
        trip.driverId && trip.driver
          ? {
              id: trip.driverId,
              fullName: trip.driver.user.fullName,
              vehicle: trip.vehicle
                ? {
                    plate: trip.vehicle.plate,
                    brand: trip.vehicle.brand,
                    model: trip.vehicle.model,
                    color: trip.vehicle.color,
                    category: trip.vehicle.category,
                  }
                : null,
            }
          : null,
      offersDeclined: trip.offersDeclined,
      trace: await this.live.trace(trip.id),
      live: isBusy(trip.status) ? await this.live.live(trip.id) : null,
      events: trip.events.map((e) => ({
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        actor: e.actor,
        at: e.at.toISOString(),
      })),
      ratings: trip.ratings.map((r) => ({
        by: r.fromUser === trip.passengerId ? ('PASSENGER' as const) : ('DRIVER' as const),
        score: r.score,
        comment: r.comment,
        at: r.createdAt.toISOString(),
      })),
    } satisfies AdminTripDetail);
  }

  /** Para el dashboard: viajes de hoy (hora de Colombia) y activos. */
  async counts(now = Date.now()): Promise<{ today: number; active: number }> {
    const startOfDay = new Date(`${colombiaDay(now)}T05:00:00.000Z`);
    const [today, active] = await Promise.all([
      this.prisma.trip.count({ where: { requestedAt: { gte: startOfDay } } }),
      this.prisma.trip.count({ where: { status: { in: [...ACTIVE_TRIP_STATUSES] } } }),
    ]);
    return { today, active };
  }

  // -------------------------------------------------------------------------------------

  /**
   * Red de seguridad (cada minuto): búsquedas que siguen abiertas más allá del límite porque se
   * perdió un job (reinicio, Redis caído). Pasan a NO_DRIVERS; las que ni empezaron, a CANCELLED.
   */
  async closeStaleSearches(now = Date.now()): Promise<number> {
    const cutoff = new Date(now - this.timings.searchTimeoutMs - 30_000);
    const stale = await this.prisma.trip.findMany({
      where: { status: { in: ['REQUESTED', 'SEARCHING'] }, requestedAt: { lt: cutoff } },
      select: { id: true, status: true },
      take: 100,
    });
    for (const trip of stale) {
      if (trip.status === 'SEARCHING') {
        await this.matching.giveUp(trip.id);
        continue;
      }
      const result = await this.transitions.transition({
        tripId: trip.id,
        to: 'CANCELLED',
        actor: 'SYSTEM',
        actorId: null,
        data: { cancelledAt: new Date(now), cancelledBy: 'SYSTEM' },
      });
      if (result.ok) this.transitions.publish(result.trip, result.from);
    }
    if (stale.length) this.logger.warn({ count: stale.length }, 'Búsquedas abandonadas cerradas');
    return stale.length;
  }

  /**
   * Limpieza al terminar (cancelado o completado): retirar la oferta en curso o liberar al
   * conductor asignado, y borrar el estado en vivo del viaje.
   */
  private async afterEnd(tripId: string, from: TripStatus, driverId: string | null): Promise<void> {
    if (from === 'REQUESTED' || from === 'SEARCHING') {
      await this.matching.stopSearch(tripId, 'CANCELLED');
    }
    if (driverId) await this.location.markFree(driverId, tripId);
    await this.live.stop(tripId);
  }

  /** El viaje existe y este conductor es el asignado; si no, 404 (sin pistas de IDOR). */
  private async assertDriverOf(driverId: string, tripId: string) {
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip || trip.driverId !== driverId) {
      throw new ApiException(404, 'NOT_FOUND', 'Viaje no encontrado');
    }
    return trip;
  }

  /** Según la última ubicación del conductor en Redis (8.8, paso 4). */
  private async assertNearPickup(
    driverId: string,
    trip: { originLat: number; originLng: number },
    radiusMeters: number,
  ): Promise<void> {
    const current = await this.location.position(driverId);
    if (!current) {
      throw new ApiException(
        409,
        'NOT_AT_PICKUP',
        'No tenemos tu ubicación. Revisa el GPS y la conexión.',
      );
    }
    const meters = haversineMeters(current.position, { lat: trip.originLat, lng: trip.originLng });
    if (meters > radiusMeters) {
      throw new ApiException(409, 'NOT_AT_PICKUP', 'Todavía estás lejos del punto de recogida.', {
        distanceMeters: Math.round(meters),
      });
    }
  }

  private participantRole(
    trip: { passengerId: string; driverId: string | null },
    viewer: Viewer,
  ): 'PASSENGER' | 'DRIVER' | null {
    if (viewer.role === 'PASSENGER' && trip.passengerId === viewer.id) return 'PASSENGER';
    if (viewer.role === 'DRIVER' && trip.driverId === viewer.id) return 'DRIVER';
    return null;
  }

  private async activeTripId(viewer: Viewer): Promise<string | null> {
    if (viewer.role !== 'PASSENGER' && viewer.role !== 'DRIVER') return null;
    const trip = await this.prisma.trip.findFirst({
      where:
        viewer.role === 'PASSENGER'
          ? { passengerId: viewer.id, status: { in: [...ACTIVE_TRIP_STATUSES] } }
          : { driverId: viewer.id, status: { in: [...DRIVER_BUSY_STATUSES] } },
      select: { id: true },
      orderBy: { requestedAt: 'desc' },
    });
    return trip?.id ?? null;
  }

  private async assertNoActiveTrip(passengerId: string): Promise<void> {
    if (await this.activeTripId({ id: passengerId, role: 'PASSENGER' })) {
      throw new ApiException(409, 'ACTIVE_TRIP_EXISTS', 'Ya tienes un viaje en curso.');
    }
  }
}
