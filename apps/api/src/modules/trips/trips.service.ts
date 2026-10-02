import { randomInt } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  ACTIVE_TRIP_STATUSES,
  AdminTripDetail,
  type AdminTripList,
  type AdminTripListQuery,
  type CancelledBy,
  type CreateTripRequest,
  type Trip as TripDto,
  type TripStatus,
  type UserRole,
} from '@rideapp/contracts';
import { ApiException } from '../../common/errors/api.exception.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { MAINTENANCE_QUEUE, QueueService } from '../../infra/queue/queue.service.js';
import { colombiaDay } from '../geo/geo.service.js';
import { LocationService } from '../location/location.service.js';
import { PricingService } from '../pricing/pricing.service.js';
import { RealtimeGateway, tripRoom } from '../realtime/realtime.gateway.js';
import { MATCHING_TIMINGS, MatchingService, type MatchingTimings } from './matching.service.js';
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

const tripInclude = {
  passenger: { select: { fullName: true } },
  driver: { select: { user: { select: { fullName: true } } } },
  vehicle: true,
} satisfies Prisma.TripInclude;

type TripWithParties = Prisma.TripGetPayload<{ include: typeof tripInclude }>;

export interface Viewer {
  id: string;
  role: UserRole;
}

/** El viaje tal como lo ve uno de sus participantes (14.4: cada parte ve solo lo suyo). */
export function toTripDto(trip: TripWithParties, viewer: 'PASSENGER' | 'DRIVER'): TripDto {
  const assigned = trip.driver !== null && trip.vehicle !== null;
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
    cancelledAt: trip.cancelledAt?.toISOString() ?? null,
    cancelledBy: trip.cancelledBy,
    cancelReason: trip.cancelReason,
    driver:
      viewer === 'PASSENGER' && assigned
        ? {
            fullName: trip.driver!.user.fullName,
            vehicle: {
              plate: trip.vehicle!.plate,
              brand: trip.vehicle!.brand,
              model: trip.vehicle!.model,
              color: trip.vehicle!.color,
              category: trip.vehicle!.category,
            },
          }
        : null,
    passenger: viewer === 'DRIVER' ? { fullName: trip.passenger.fullName } : null,
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
    return toTripDto(trip, role);
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
    return this.get(viewer, tripId);
  }

  /** El conductor acepta la oferta (8.9, paso 7). */
  async accept(driverId: string, tripId: string): Promise<TripDto> {
    await this.matching.accept(driverId, tripId);
    return this.get({ id: driverId, role: 'DRIVER' }, tripId);
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
      ...toTripDto(trip, 'DRIVER'),
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
      events: trip.events.map((e) => ({
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        actor: e.actor,
        at: e.at.toISOString(),
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

  /** Limpieza tras cancelar: retirar la oferta en curso o liberar al conductor asignado. */
  private async afterEnd(tripId: string, from: TripStatus, driverId: string | null): Promise<void> {
    if (from === 'REQUESTED' || from === 'SEARCHING') {
      await this.matching.stopSearch(tripId, 'CANCELLED');
    }
    if (driverId) await this.location.markFree(driverId, tripId);
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
