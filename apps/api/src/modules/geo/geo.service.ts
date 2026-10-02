import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AutocompleteSuggestion, LatLng, PlaceDetails } from '@rideapp/contracts';
import { PlaceDetails as PlaceDetailsSchema } from '@rideapp/contracts';
import { ApiException } from '../../common/errors/api.exception.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { RedisService } from '../../infra/redis/redis.service.js';
import { FakeMapsProvider } from './fake-maps.provider.js';
import {
  MAPS_PROVIDER,
  type MapsProvider,
  MapsQuotaExceededError,
  type RouteResult,
} from './maps-provider.js';

export type MapsSku = 'autocomplete' | 'place' | 'reverse' | 'route';
export const MAPS_SKUS: readonly MapsSku[] = ['autocomplete', 'place', 'reverse', 'route'];

/** Llamadas a Google por usuario y día (8.6, paso 5). Lo que sale de la caché no cuenta. */
export const DAILY_USER_LIMITS: Record<MapsSku, number> = {
  autocomplete: 60,
  place: 30,
  reverse: 60,
  route: 20,
};

/** Términos de Google: coordenadas en caché 30 días como máximo (12.3). */
const COORDS_CACHE_SECONDS = 30 * 24 * 3600;
/** Una ruta repetida (volver a cotizar el mismo trayecto) sale de la caché unos minutos. */
const ROUTE_CACHE_SECONDS = 10 * 60;
const METRICS_TTL_SECONDS = 40 * 24 * 3600;
/** Colombia no tiene horario de verano: el día empieza a las 05:00 UTC. */
const COLOMBIA_OFFSET_MS = 5 * 3600 * 1000;

export function colombiaDay(now = Date.now()): string {
  return new Date(now - COLOMBIA_OFFSET_MS).toISOString().slice(0, 10);
}

const round4 = (v: number) => v.toFixed(4);

/**
 * Fachada de mapas (8.6): límites por usuario, caché, contador global, validación de la zona de
 * servicio con PostGIS antes de gastar cuota y respaldo de rutas si Google se agota (12.4).
 */
@Injectable()
export class GeoService {
  private readonly logger = new Logger(GeoService.name);

  constructor(
    @Inject(MAPS_PROVIDER) private readonly provider: MapsProvider,
    private readonly fallback: FakeMapsProvider,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  get providerName(): MapsProvider['name'] {
    return this.provider.name;
  }

  /** ¿El punto está dentro de la zona de servicio? (polígono en PostGIS, 8.6, paso 6). */
  async inServiceArea({ lat, lng }: LatLng): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ inside: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM service_areas
        WHERE active AND ST_Covers(area, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography)
      ) AS inside`;
    return rows[0]?.inside === true;
  }

  async assertInServiceArea(...points: LatLng[]): Promise<void> {
    for (const p of points) {
      if (!(await this.inServiceArea(p))) {
        throw new ApiException(
          422,
          'OUT_OF_SERVICE_AREA',
          'Por ahora solo operamos en Girardot, Ricaurte y Flandes.',
        );
      }
    }
  }

  async autocomplete(
    userId: string,
    query: string,
    sessionToken: string,
  ): Promise<AutocompleteSuggestion[]> {
    await this.consume(userId, 'autocomplete');
    return this.call('autocomplete', () => this.provider.autocomplete(query, sessionToken));
  }

  async placeDetails(userId: string, placeId: string, sessionToken: string): Promise<PlaceDetails> {
    const key = `cache:geo:place:${placeId}`;
    const cached = await this.readCache(key, PlaceDetailsSchema);
    let place = cached;
    if (!place) {
      await this.consume(userId, 'place');
      place = await this.call('place', () => this.provider.placeDetails(placeId, sessionToken));
      if (!place) throw new ApiException(404, 'NOT_FOUND', 'No encontramos ese lugar.');
      await this.redis.client.set(key, JSON.stringify(place), 'EX', COORDS_CACHE_SECONDS);
    }
    await this.assertInServiceArea(place.location);
    return place;
  }

  /**
   * Dirección de un punto. Se redondea a 4 decimales (~11 m) para aprovechar la caché. Si Google
   * falla se devuelve null: el punto sigue sirviendo aunque no tenga texto.
   */
  async reverseGeocode(userId: string, point: LatLng): Promise<string | null> {
    await this.assertInServiceArea(point);
    const rounded = { lat: Number(round4(point.lat)), lng: Number(round4(point.lng)) };
    const key = `cache:geo:rev:${round4(point.lat)},${round4(point.lng)}`;
    const cached = await this.redis.client.get(key);
    if (cached !== null) return cached || null;

    await this.consume(userId, 'reverse');
    try {
      const address = await this.call('reverse', () => this.provider.reverseGeocode(rounded));
      // También se guarda "sin resultado" (cadena vacía) para no volver a preguntar.
      await this.redis.client.set(key, address ?? '', 'EX', COORDS_CACHE_SECONDS);
      return address;
    } catch (err) {
      this.logger.warn({ err }, 'Geocodificación inversa no disponible');
      return null;
    }
  }

  /**
   * Ruta para cotizar (y, en la Fase 4, conductor → recogida). Si Google agotó la cuota o no
   * responde, se usa la línea recta × 1,3 del FakeMapsProvider y se avisa en el log (12.4, paso 3).
   */
  async route(userId: string | null, origin: LatLng, destination: LatLng): Promise<RouteResult> {
    const key = `cache:geo:route:${round4(origin.lat)},${round4(origin.lng)}:${round4(destination.lat)},${round4(destination.lng)}`;
    const cached = await this.redis.client.get(key);
    if (cached) {
      try {
        return JSON.parse(cached) as RouteResult;
      } catch {
        // Entrada corrupta: se recalcula.
      }
    }
    if (userId) await this.consume(userId, 'route');
    let route: RouteResult;
    try {
      route = await this.call('route', () => this.provider.route(origin, destination));
    } catch (err) {
      if (this.provider === this.fallback) throw err;
      this.logger.warn(
        { err, quota: err instanceof MapsQuotaExceededError },
        'Routes no disponible: se usa la ruta aproximada',
      );
      return this.fallback.route(origin, destination);
    }
    await this.redis.client.set(key, JSON.stringify(route), 'EX', ROUTE_CACHE_SECONDS);
    return route;
  }

  /** Llamadas de hoy al proveedor, por SKU (panel admin). */
  async callsToday(now = Date.now()): Promise<Record<MapsSku, number>> {
    const day = colombiaDay(now);
    const values = await this.redis.client.mget(
      MAPS_SKUS.map((sku) => `metrics:maps:${this.provider.name}:${sku}:${day}`),
    );
    return Object.fromEntries(MAPS_SKUS.map((sku, i) => [sku, Number(values[i] ?? 0)])) as Record<
      MapsSku,
      number
    >;
  }

  /** Cuenta la llamada contra el límite diario del usuario; 429 si ya lo agotó. */
  private async consume(userId: string, sku: MapsSku, now = Date.now()): Promise<void> {
    const key = `quota:maps:${sku}:${userId}:${colombiaDay(now)}`;
    const [[, count]] = (await this.redis.client
      .multi()
      .incr(key)
      .expire(key, 26 * 3600, 'NX')
      .exec()) as [[unknown, number], unknown];
    if (count > DAILY_USER_LIMITS[sku]) {
      throw new ApiException(
        429,
        'RATE_LIMITED',
        'Alcanzaste el límite diario de búsquedas. Inténtalo mañana o elige el punto en el mapa.',
      );
    }
  }

  /** Ejecuta la llamada, la cuenta en las métricas y traduce los errores del proveedor. */
  private async call<T>(sku: MapsSku, fn: () => Promise<T>): Promise<T> {
    const metric = `metrics:maps:${this.provider.name}:${sku}:${colombiaDay()}`;
    void this.redis.client
      .multi()
      .incr(metric)
      .expire(metric, METRICS_TTL_SECONDS, 'NX')
      .exec()
      .catch(() => undefined);
    try {
      return await fn();
    } catch (err) {
      if (sku === 'route' || sku === 'reverse') throw err;
      this.logger.warn({ err, sku }, 'Proveedor de mapas no disponible');
      throw new ApiException(
        503,
        'SERVICE_UNAVAILABLE',
        'La búsqueda de direcciones no está disponible. Elige el punto en el mapa.',
      );
    }
  }

  private async readCache<T>(
    key: string,
    schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } },
  ): Promise<T | null> {
    const raw = await this.redis.client.get(key);
    if (!raw) return null;
    try {
      const parsed = schema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }
}
