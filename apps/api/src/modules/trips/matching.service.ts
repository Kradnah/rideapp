import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  approximateArea,
  type DriverOffer,
  SocketEvent,
  type TripOfferCancelledV1,
} from '@rideapp/contracts';
import { z } from 'zod';
import { ApiException } from '../../common/errors/api.exception.js';
import type { Trip } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { QueueService } from '../../infra/queue/queue.service.js';
import { RedisService } from '../../infra/redis/redis.service.js';
import { DriversService } from '../drivers/drivers.service.js';
import { LocationService } from '../location/location.service.js';
import { RealtimeGateway, tripRoom } from '../realtime/realtime.gateway.js';
import { isUniqueViolation, TripTransitions } from './trip-transitions.js';

export const MATCHING_QUEUE = 'matching';

/** Tiempos del emparejamiento (8.9). Inyectables para que los tests no esperen minutos. */
export interface MatchingTimings {
  /** Lo que tiene el conductor para responder a una oferta. */
  offerTtlMs: number;
  /** Margen para la latencia de red al aceptar justo al final. */
  graceMs: number;
  /** Sin conductor en este tiempo, el viaje pasa a NO_DRIVERS (8.9, paso 8). */
  searchTimeoutMs: number;
  /** Cada cuánto se vuelve a buscar si no hubo candidatos. */
  retryDelayMs: number;
  /** El radio crece con el tiempo: 3 → 5 → 8 km. */
  radiiKm: readonly number[];
  radiusStepMs: number;
}

export const DEFAULT_MATCHING_TIMINGS: MatchingTimings = {
  offerTtlMs: 15_000,
  graceMs: 2_000,
  searchTimeoutMs: 120_000,
  retryDelayMs: 5_000,
  radiiKm: [3, 5, 8],
  radiusStepMs: 30_000,
};

export const MATCHING_TIMINGS = Symbol('MATCHING_TIMINGS');

const offerKey = (tripId: string) => `trip:${tripId}:offer`;
const rejectedKey = (tripId: string) => `trip:${tripId}:rejected`;
const lockKey = (tripId: string) => `trip:${tripId}:lock`;
/** Generación de la búsqueda: solo el job de búsqueda más reciente de cada viaje sigue vivo. */
const generationKey = (tripId: string) => `trip:${tripId}:search-gen`;
const SEARCH_STATE_TTL_SECONDS = 3600;
const OFFER_KEY_MARGIN_MS = 10_000;

const StoredOffer = z.object({
  offerId: z.string(),
  driverId: z.string(),
  expiresAtMs: z.number(),
  payload: z.custom<DriverOffer>(),
});
type StoredOffer = z.infer<typeof StoredOffer>;

const FindJob = z.object({ tripId: z.uuid(), generation: z.number().int() });
const TimeoutJob = z.object({ tripId: z.uuid(), offerId: z.string() });

/**
 * Emparejamiento (8.9): ofrece el viaje a un conductor a la vez, del más cercano al más lejano,
 * con 15 s para responder. Rechazar o dejar caducar la oferta pasa al siguiente; aceptar usa un
 * lock en Redis (`SET NX PX`) y la transición optimista en Postgres, así que solo uno gana.
 */
@Injectable()
export class MatchingService implements OnModuleInit {
  private readonly logger = new Logger(MatchingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly queues: QueueService,
    private readonly location: LocationService,
    private readonly drivers: DriversService,
    private readonly realtime: RealtimeGateway,
    private readonly transitions: TripTransitions,
    @Inject(MATCHING_TIMINGS) private readonly timings: MatchingTimings,
  ) {}

  onModuleInit(): void {
    this.queues.handle(MATCHING_QUEUE, 'find', (job) => this.find(FindJob.parse(job.data)), 8);
    this.queues.handle(MATCHING_QUEUE, 'offer-timeout', (job) => {
      const { tripId, offerId } = TimeoutJob.parse(job.data);
      return this.expireOffer(tripId, offerId);
    });
  }

  /** Empieza (o reanuda de inmediato) la búsqueda de conductor de un viaje en SEARCHING. */
  async search(tripId: string, delayMs = 0): Promise<void> {
    const key = generationKey(tripId);
    const [[, generation]] = (await this.redis.client
      .multi()
      .incr(key)
      .expire(key, SEARCH_STATE_TTL_SECONDS)
      .exec()) as [[unknown, number], unknown];
    await this.queues.add(MATCHING_QUEUE, 'find', { tripId, generation }, { delay: delayMs });
  }

  /** Un paso de la búsqueda: ofrecer al mejor candidato libre o reintentar en unos segundos. */
  async find({ tripId, generation }: { tripId: string; generation: number }): Promise<void> {
    const current = Number(await this.redis.client.get(generationKey(tripId)));
    if (current !== generation) return; // Otro job más reciente tomó el relevo.

    const trip = await this.prisma.trip.findUnique({ where: { id: tripId } });
    if (trip?.status !== 'SEARCHING') return;

    const now = Date.now();
    const elapsed = now - trip.requestedAt.getTime();
    if (elapsed >= this.timings.searchTimeoutMs) {
      await this.giveUp(tripId);
      return;
    }
    // Hay una oferta en curso: la resolverá la respuesta del conductor o su caducidad.
    if (await this.redis.client.exists(offerKey(tripId))) return;

    const { radiiKm, radiusStepMs } = this.timings;
    const radiusKm = radiiKm[Math.min(Math.floor(elapsed / radiusStepMs), radiiKm.length - 1)]!;
    const origin = { lat: trip.originLat, lng: trip.originLng };
    const [rejected, candidates] = await Promise.all([
      this.redis.client.smembers(rejectedKey(tripId)),
      this.location.candidates(origin, trip.category, radiusKm),
    ]);
    const skip = new Set(rejected);

    for (const candidate of candidates) {
      if (skip.has(candidate.driverId) || candidate.driverId === trip.passengerId) continue;
      const offered = await this.offer(trip, candidate.driverId, candidate.distanceMeters, now);
      if (offered !== 'unavailable') return;
    }
    await this.search(tripId, this.timings.retryDelayMs);
  }

  /** Oferta pendiente del conductor, para la app que perdió el evento (GET /drivers/me/offer). */
  async currentOffer(driverId: string, now = Date.now()): Promise<DriverOffer | null> {
    const tripId = await this.location.offeredTrip(driverId);
    if (!tripId) return null;
    const offer = await this.readOffer(tripId);
    if (!offer || offer.driverId !== driverId || offer.expiresAtMs <= now) return null;
    return offer.payload;
  }

  /**
   * El conductor acepta (8.9, paso 7). Solo el conductor ofertado, antes de que caduque, y con el
   * lock del viaje. Devuelve el viaje ya asignado.
   */
  async accept(driverId: string, tripId: string, now = Date.now()): Promise<Trip> {
    const offer = await this.readOffer(tripId);
    if (!offer || offer.driverId !== driverId || now > offer.expiresAtMs + this.timings.graceMs) {
      throw new ApiException(409, 'CONFLICT', 'Esta oferta ya no está disponible.');
    }
    const locked = await this.redis.client.set(lockKey(tripId), driverId, 'PX', 15_000, 'NX');
    if (locked !== 'OK') {
      throw new ApiException(409, 'CONFLICT', 'Otro conductor tomó este viaje.');
    }

    const vehicleId =
      (await this.location.vehicleOf(driverId)) ?? (await this.drivers.activeVehicleId(driverId));
    let result;
    try {
      result = await this.transitions.transition({
        tripId,
        from: ['SEARCHING'],
        to: 'DRIVER_ASSIGNED',
        actor: 'DRIVER',
        actorId: driverId,
        data: { driverId, vehicleId, acceptedAt: new Date(now) },
      });
    } catch (err) {
      await this.redis.client.del(lockKey(tripId));
      // Índice único parcial: el conductor ya tiene otro viaje activo.
      if (isUniqueViolation(err)) {
        throw new ApiException(409, 'ACTIVE_TRIP_EXISTS', 'Ya tienes un viaje en curso.');
      }
      throw err;
    }
    if (!result.ok) {
      await this.redis.client.del(lockKey(tripId));
      await this.clearOffer(tripId, offer);
      throw new ApiException(409, 'CONFLICT', 'Este viaje ya no está disponible.');
    }

    await this.redis.client.del(offerKey(tripId), generationKey(tripId), rejectedKey(tripId));
    await this.location.markBusy(driverId, tripId);
    this.realtime.joinUser(driverId, tripRoom(tripId));
    this.transitions.publish(result.trip, result.from);
    return result.trip;
  }

  /** El conductor rechaza: se ofrece al siguiente de inmediato. */
  async reject(driverId: string, tripId: string): Promise<void> {
    const offer = await this.readOffer(tripId);
    if (!offer || offer.driverId !== driverId) {
      throw new ApiException(409, 'CONFLICT', 'Esta oferta ya no está disponible.');
    }
    await this.decline(tripId, offer, null);
  }

  /** La oferta caducó sin respuesta (job retrasado de 15 s, 8.9, paso 6). */
  async expireOffer(tripId: string, offerId: string): Promise<void> {
    const offer = await this.readOffer(tripId);
    if (!offer || offer.offerId !== offerId) return; // Ya se respondió.
    await this.decline(tripId, offer, 'EXPIRED');
  }

  /**
   * El viaje dejó de buscar (cancelado o sin conductores): se retira la oferta en curso, si la hay,
   * y se avisa a ese conductor.
   */
  async stopSearch(tripId: string, reason: TripOfferCancelledV1['reason']): Promise<void> {
    await this.redis.client.incr(generationKey(tripId));
    const offer = await this.readOffer(tripId);
    if (offer) {
      await this.clearOffer(tripId, offer);
      this.realtime.emitToUser(offer.driverId, SocketEvent.TripOfferCancelled, { tripId, reason });
    }
    await this.redis.client.del(rejectedKey(tripId), generationKey(tripId));
  }

  /** 2 minutos sin conductor: NO_DRIVERS y aviso al pasajero (8.9, paso 8). */
  async giveUp(tripId: string): Promise<void> {
    const result = await this.transitions.transition({
      tripId,
      from: ['SEARCHING'],
      to: 'NO_DRIVERS',
      actor: 'SYSTEM',
      actorId: null,
    });
    await this.stopSearch(tripId, 'CANCELLED');
    if (result.ok) this.transitions.publish(result.trip, result.from);
  }

  private async offer(
    trip: Trip,
    driverId: string,
    pickupDistanceMeters: number,
    now: number,
  ): Promise<'offered' | 'unavailable' | 'busy'> {
    const { offerTtlMs, graceMs } = this.timings;
    // La oferta (y la reserva del conductor) deben vivir más que el job que la hace caducar:
    // si Redis la borrara antes, nadie pasaría al siguiente conductor.
    const keepMs = offerTtlMs + graceMs + OFFER_KEY_MARGIN_MS;
    if (!(await this.location.reserveForOffer(driverId, trip.id, keepMs, now))) {
      return 'unavailable';
    }
    const expiresAtMs = now + offerTtlMs;
    const payload: DriverOffer = {
      tripId: trip.id,
      pickupDistanceMeters,
      pickupArea: approximateArea({ lat: trip.originLat, lng: trip.originLng }),
      destinationArea: approximateArea({ lat: trip.destinationLat, lng: trip.destinationLng }),
      amount: { amountCents: trip.amountCents, currency: trip.currency },
      paymentMethod: trip.paymentMethod,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
    const stored: StoredOffer = { offerId: randomUUID(), driverId, expiresAtMs, payload };
    const set = await this.redis.client.set(
      offerKey(trip.id),
      JSON.stringify(stored),
      'PX',
      keepMs,
      'NX',
    );
    if (set !== 'OK') {
      // Otro job ofertó este viaje en paralelo: se suelta al conductor.
      await this.location.releaseOffer(driverId, trip.id);
      return 'busy';
    }
    this.realtime.emitToUser(driverId, SocketEvent.TripOffer, payload);
    await this.queues.add(
      MATCHING_QUEUE,
      'offer-timeout',
      { tripId: trip.id, offerId: stored.offerId },
      // Después del margen en el que aún se admite aceptar.
      { delay: offerTtlMs + graceMs },
    );
    this.logger.log({ tripId: trip.id, driverId, pickupDistanceMeters }, 'Oferta enviada');
    return 'offered';
  }

  private async decline(
    tripId: string,
    offer: StoredOffer,
    notify: TripOfferCancelledV1['reason'] | null,
  ): Promise<void> {
    const removed = await this.clearOffer(tripId, offer);
    if (!removed) return; // Otro proceso ya la resolvió.
    await this.redis.client
      .multi()
      .sadd(rejectedKey(tripId), offer.driverId)
      .expire(rejectedKey(tripId), SEARCH_STATE_TTL_SECONDS)
      .exec();
    await this.prisma.trip.updateMany({
      where: { id: tripId, status: 'SEARCHING' },
      data: { offersDeclined: { increment: 1 } },
    });
    if (notify) {
      this.realtime.emitToUser(offer.driverId, SocketEvent.TripOfferCancelled, {
        tripId,
        reason: notify,
      });
    }
    await this.search(tripId);
  }

  /** Borra la oferta solo si sigue siendo esta (mismo `offerId`) y suelta al conductor. */
  private async clearOffer(tripId: string, offer: StoredOffer): Promise<boolean> {
    const deleted = await this.redis.client.eval(
      `local v = redis.call('GET', KEYS[1])
       if v and cjson.decode(v)['offerId'] == ARGV[1] then return redis.call('DEL', KEYS[1]) end
       return 0`,
      1,
      offerKey(tripId),
      offer.offerId,
    );
    await this.location.releaseOffer(offer.driverId, tripId);
    return deleted === 1;
  }

  private async readOffer(tripId: string): Promise<StoredOffer | null> {
    const raw = await this.redis.client.get(offerKey(tripId));
    if (!raw) return null;
    try {
      const parsed = StoredOffer.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }
}
