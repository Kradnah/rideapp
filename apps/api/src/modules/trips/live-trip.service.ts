import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  decodePolyline,
  type DriverLocationV1,
  haversineMeters,
  type LatLng,
  routeProgress,
  SocketEvent,
  TripDriverLocation,
} from '@rideapp/contracts';
import { z } from 'zod';
import type { Trip } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { MAINTENANCE_QUEUE, QueueService } from '../../infra/queue/queue.service.js';
import { RedisService } from '../../infra/redis/redis.service.js';
import { FAKE_AVG_SPEED_MPS, FAKE_ROUTE_FACTOR } from '../geo/fake-maps.provider.js';
import { GeoService } from '../geo/geo.service.js';
import { LocationService } from '../location/location.service.js';
import { RealtimeGateway, tripRoom } from '../realtime/realtime.gateway.js';

/** Tiempos del viaje en vivo. Inyectables para que los tests no esperen. */
export interface LiveTripTimings {
  /** Un punto de la traza cada tanto (8.5, paso 2: ~10 s). */
  sampleEveryMs: number;
  /** Cada cuánto se pasan a Postgres los puntos acumulados en Redis. */
  flushEveryMs: number;
  /** Como mucho una ruta nueva a Google por viaje en este tiempo (9.4, paso 2: 2 min). */
  rerouteMinGapMs: number;
}

export const DEFAULT_LIVE_TRIP_TIMINGS: LiveTripTimings = {
  sampleEveryMs: 10_000,
  flushEveryMs: 10_000,
  rerouteMinGapMs: 120_000,
};

export const LIVE_TRIP_TIMINGS = Symbol('LIVE_TRIP_TIMINGS');

/** Más lejos que esto de la ruta, el conductor se desvió y se pide una ruta nueva (9.4, paso 2). */
const OFF_ROUTE_METERS = 200;
const LIVE_TTL_SECONDS = 120;
const ETA_TTL_SECONDS = 6 * 3600;
const FLUSH_BATCH = 500;

const ROUTE_POINTS_KEY = 'trips:route-points';
/** Hacia dónde va el conductor y la ruta con la que se estima el ETA. */
const etaKey = (tripId: string) => `trip:${tripId}:eta`;
/** Última posición enviada al pasajero, para quien abre la pantalla después. */
const liveKey = (tripId: string) => `trip:${tripId}:live`;
const sampleKey = (tripId: string) => `trip:${tripId}:sample`;
const rerouteKey = (tripId: string) => `trip:${tripId}:reroute`;

const BufferedPoint = z.object({
  tripId: z.uuid(),
  lat: z.number(),
  lng: z.number(),
  at: z.number().int(),
});

interface EtaState {
  target: LatLng;
  route: { points: LatLng[]; durationSeconds: number } | null;
}

/**
 * Viaje en vivo (Fase 4): con cada posición del conductor en viaje,
 * - estima el ETA en el servidor sobre una ruta calculada una sola vez (al aceptar, y al iniciar
 *   se usa la ruta ya cotizada); solo vuelve a pedirla si el conductor se desvía > 200 m, y como
 *   mucho una vez cada 2 min (9.4, paso 2);
 * - reenvía la posición solo a la sala del viaje (`trip.driverLocation.v1`, 8.10);
 * - muestrea un punto cada ~10 s para la traza, que se guarda en lote con un job (8.5, paso 2).
 */
@Injectable()
export class LiveTripService implements OnModuleInit {
  private readonly logger = new Logger(LiveTripService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly geo: GeoService,
    private readonly location: LocationService,
    private readonly realtime: RealtimeGateway,
    private readonly queues: QueueService,
    @Inject(LIVE_TRIP_TIMINGS) private readonly timings: LiveTripTimings,
  ) {}

  onModuleInit(): void {
    this.realtime.registerTripLocationListener((_driverId, tripId, loc) =>
      this.onDriverLocation(tripId, loc),
    );
    this.queues.every(MAINTENANCE_QUEUE, 'route-points-flush', this.timings.flushEveryMs, () =>
      this.flushRoutePoints(),
    );
  }

  /** Conductor asignado: el ETA es hasta la recogida, con la ruta desde donde está ahora. */
  async onAssigned(trip: Trip): Promise<void> {
    await this.setTarget(trip.id, { lat: trip.originLat, lng: trip.originLng });
    const from = trip.driverId ? await this.location.position(trip.driverId) : null;
    // Sin posición todavía: la ruta se pide con la primera que llegue.
    if (from && (await this.claimReroute(trip.id))) {
      void this.reroute(trip.id, from.position);
    }
  }

  /** Llegó a la recogida: ya no hay ETA que mostrar hasta que empiece el viaje. */
  async onArrived(tripId: string): Promise<void> {
    await this.redis.client.del(etaKey(tripId));
  }

  /** Viaje iniciado: el ETA es hasta el destino, sobre la ruta cotizada (sin llamar a Google). */
  async onStarted(trip: Trip): Promise<void> {
    await this.redis.client
      .multi()
      .del(etaKey(trip.id))
      .hset(etaKey(trip.id), {
        lat: trip.destinationLat,
        lng: trip.destinationLng,
        polyline: trip.polyline,
        durationS: trip.durationS,
      })
      .expire(etaKey(trip.id), ETA_TTL_SECONDS)
      .set(rerouteKey(trip.id), '1', 'PX', this.timings.rerouteMinGapMs)
      .exec();
  }

  /** El viaje terminó (completado o cancelado): se borra todo su estado en vivo. */
  async stop(tripId: string): Promise<void> {
    await this.redis.client.del(
      etaKey(tripId),
      liveKey(tripId),
      sampleKey(tripId),
      rerouteKey(tripId),
    );
  }

  /** Última posición del conductor de un viaje activo (pasajero al abrir la pantalla, panel). */
  async live(tripId: string): Promise<TripDriverLocation | null> {
    const raw = await this.redis.client.get(liveKey(tripId));
    if (!raw) return null;
    try {
      return TripDriverLocation.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  /** Traza guardada del viaje (panel). */
  async trace(tripId: string): Promise<LatLng[]> {
    return this.prisma.tripRoutePoint.findMany({
      where: { tripId },
      orderBy: { at: 'asc' },
      select: { lat: true, lng: true },
      take: 5000,
    });
  }

  async onDriverLocation(tripId: string, loc: DriverLocationV1): Promise<void> {
    const position = { lat: loc.lat, lng: loc.lng };
    const eta = await this.readEta(tripId);
    let etaSeconds: number | null = null;
    if (eta) {
      const estimate = estimateEta(eta, position);
      etaSeconds = estimate.seconds;
      if (estimate.needsRoute && (await this.claimReroute(tripId))) {
        void this.reroute(tripId, position);
      }
    }

    const payload: TripDriverLocation = {
      tripId,
      position,
      heading: loc.heading,
      etaSeconds,
      ts: loc.ts,
    };
    this.realtime.emitToRooms([tripRoom(tripId)], SocketEvent.TripDriverLocation, payload);

    const sampled = await this.redis.client.set(
      sampleKey(tripId),
      '1',
      'PX',
      this.timings.sampleEveryMs,
      'NX',
    );
    const write = this.redis.client
      .multi()
      .set(liveKey(tripId), JSON.stringify(payload), 'EX', LIVE_TTL_SECONDS);
    if (sampled === 'OK') {
      write.rpush(ROUTE_POINTS_KEY, JSON.stringify({ tripId, ...position, at: loc.ts }));
    }
    await write.exec();
  }

  /** Pasa a Postgres los puntos de la traza acumulados en Redis (job cada 10 s). */
  async flushRoutePoints(): Promise<number> {
    let total = 0;
    for (;;) {
      const raw = await this.redis.client.lpop(ROUTE_POINTS_KEY, FLUSH_BATCH);
      if (!raw?.length) return total;
      const points = raw.flatMap((item) => {
        try {
          const p = BufferedPoint.parse(JSON.parse(item));
          return [{ tripId: p.tripId, lat: p.lat, lng: p.lng, at: new Date(p.at) }];
        } catch {
          return [];
        }
      });
      try {
        await this.prisma.tripRoutePoint.createMany({ data: points });
        total += points.length;
      } catch (err) {
        // Un lote que no se puede guardar se descarta: la traza es un dato de apoyo.
        this.logger.warn({ err, count: points.length }, 'Se descartaron puntos de la traza');
      }
      if (raw.length < FLUSH_BATCH) return total;
    }
  }

  // -------------------------------------------------------------------------------------

  private async setTarget(tripId: string, target: LatLng): Promise<void> {
    await this.redis.client
      .multi()
      .del(etaKey(tripId))
      .hset(etaKey(tripId), { lat: target.lat, lng: target.lng })
      .expire(etaKey(tripId), ETA_TTL_SECONDS)
      .exec();
  }

  private async readEta(tripId: string): Promise<EtaState | null> {
    const h = await this.redis.client.hgetall(etaKey(tripId));
    if (!h['lat'] || !h['lng']) return null;
    let route: EtaState['route'] = null;
    if (h['polyline'] && h['durationS']) {
      try {
        route = { points: decodePolyline(h['polyline']), durationSeconds: Number(h['durationS']) };
      } catch {
        route = null;
      }
    }
    return { target: { lat: Number(h['lat']), lng: Number(h['lng']) }, route };
  }

  /** Como mucho una ruta nueva por viaje cada `rerouteMinGapMs`, aunque haya varias réplicas. */
  private async claimReroute(tripId: string): Promise<boolean> {
    const ok = await this.redis.client.set(
      rerouteKey(tripId),
      '1',
      'PX',
      this.timings.rerouteMinGapMs,
      'NX',
    );
    return ok === 'OK';
  }

  /** Pide la ruta desde la posición actual hasta el objetivo (si Google falla, la aproximada). */
  private async reroute(tripId: string, from: LatLng): Promise<void> {
    try {
      const before = await this.readEta(tripId);
      if (!before) return;
      const route = await this.geo.route(null, from, before.target);
      // Si mientras tanto cambió el objetivo (llegó o empezó el viaje), esta ruta ya no sirve.
      const after = await this.readEta(tripId);
      if (!after || haversineMeters(after.target, before.target) > 1) return;
      await this.redis.client.hset(etaKey(tripId), {
        polyline: route.polyline,
        durationS: route.durationSeconds,
      });
    } catch (err) {
      this.logger.warn({ err, tripId }, 'No se pudo calcular la ruta del conductor');
    }
  }
}

/**
 * ETA a partir de la ruta guardada: la duración de la ruta en proporción a lo que falta por
 * recorrer, más el desvío a velocidad urbana. Sin ruta (o si se desvió), se estima en línea recta
 * y se pide una ruta nueva.
 */
export function estimateEta(
  eta: EtaState,
  position: LatLng,
): { seconds: number; needsRoute: boolean } {
  if (eta.route && eta.route.points.length > 0) {
    const progress = routeProgress(eta.route.points, position);
    if (progress.totalMeters >= 1) {
      const onRoute = eta.route.durationSeconds * (progress.remainingMeters / progress.totalMeters);
      return {
        seconds: Math.round(onRoute + progress.offRouteMeters / FAKE_AVG_SPEED_MPS),
        needsRoute: progress.offRouteMeters > OFF_ROUTE_METERS,
      };
    }
  }
  const straight = haversineMeters(position, eta.target) * FAKE_ROUTE_FACTOR;
  return { seconds: Math.round(straight / FAKE_AVG_SPEED_MPS), needsRoute: true };
}
