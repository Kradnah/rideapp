import { Injectable, Logger } from '@nestjs/common';
import {
  type AdminLiveDriver,
  type DriverAvailability,
  type DriverLocationRejection,
  type DriverLocationV1,
  haversineMeters,
  isInServiceAreaBounds,
  type LatLng,
  type NearbyDriver,
  VehicleCategory,
} from '@rideapp/contracts';
import { RedisService } from '../../infra/redis/redis.service.js';

/** Sin ubicación durante este tiempo, el conductor deja de estar en línea (8.0, claves en Redis). */
export const PRESENCE_TTL_SECONDS = 60;
/** Cada cuánto envía su posición un conductor libre (8.5, paso 1: 10–15 s). */
export const AVAILABLE_INTERVAL_SECONDS = 12;
const MAX_ACCURACY_METERS = 100;
/** ~200 km/h: más rápido que eso entre dos lecturas es GPS falso o un salto (8.5, paso 2). */
const MAX_PLAUSIBLE_SPEED_MPS = 200 / 3.6;
/** Por debajo de esta distancia no se juzga la velocidad: el ruido del GPS daría falsos positivos. */
const MIN_JUMP_METERS = 150;
const MAX_FUTURE_MS = 30_000;
const MAX_AGE_MS = 120_000;
const NEARBY_RADIUS_KM = 3;
const NEARBY_LIMIT = 10;

const ONLINE_KEY = 'drivers:online';
const stateKey = (driverId: string) => `driver:${driverId}:state`;
const geoKey = (category: VehicleCategory) => `geo:drivers:available:${category}`;
const GEO_KEYS = VehicleCategory.options.map(geoKey);

/**
 * Actualiza la posición de forma atómica solo si el conductor sigue en línea: así un
 * "fuera de línea" simultáneo no deja un fantasma en la capa GEO.
 * KEYS: estado, geo STANDARD, geo MOTO, zset de en línea.
 * ARGV: id, lat, lng, heading, speed, fixTs, now, ttl, inArea.
 */
const UPDATE_LOCATION_LUA = `
local avail = redis.call('HGET', KEYS[1], 'availability')
if not avail then return 0 end
redis.call('HSET', KEYS[1], 'lat', ARGV[2], 'lng', ARGV[3], 'heading', ARGV[4], 'speed', ARGV[5], 'fixTs', ARGV[6], 'lastSeen', ARGV[7])
redis.call('EXPIRE', KEYS[1], ARGV[8])
redis.call('ZADD', KEYS[4], ARGV[7], ARGV[1])
local geo = KEYS[2]
if redis.call('HGET', KEYS[1], 'category') == 'MOTO' then geo = KEYS[3] end
if avail == 'AVAILABLE' and ARGV[9] == '1' then
  redis.call('GEOADD', geo, ARGV[3], ARGV[2], ARGV[1])
else
  redis.call('ZREM', geo, ARGV[1])
end
return 1
`;

/** Quita a un conductor solo si sigue inactivo (no pisa una actualización recién llegada). */
const SWEEP_ONE_LUA = `
local score = redis.call('ZSCORE', KEYS[4], ARGV[1])
if score and tonumber(score) >= tonumber(ARGV[2]) then return 0 end
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('ZREM', KEYS[3], ARGV[1])
redis.call('ZREM', KEYS[4], ARGV[1])
redis.call('DEL', KEYS[1])
return 1
`;

type LuaRedis = {
  rideappUpdateLocation(...args: (string | number)[]): Promise<number>;
  rideappSweepOne(...args: (string | number)[]): Promise<number>;
};

export type LocationResult = { ok: true } | { ok: false; code: DriverLocationRejection };

/**
 * Ubicación y disponibilidad en vivo de los conductores (8.5). Solo vive en Redis, con TTL:
 * Postgres no guarda posiciones de conductores libres (15.1).
 */
@Injectable()
export class LocationService {
  private readonly logger = new Logger(LocationService.name);
  private readonly lua: LuaRedis;

  constructor(private readonly redis: RedisService) {
    const client = redis.client;
    client.defineCommand('rideappUpdateLocation', { numberOfKeys: 4, lua: UPDATE_LOCATION_LUA });
    client.defineCommand('rideappSweepOne', { numberOfKeys: 4, lua: SWEEP_ONE_LUA });
    this.lua = client as unknown as LuaRedis;
  }

  async goOnline(
    driverId: string,
    { category, vehicleId }: { category: VehicleCategory; vehicleId: string },
    now = Date.now(),
  ): Promise<void> {
    await this.redis.client
      .multi()
      // Si cambió de vehículo, no debe quedar en la capa de la otra categoría.
      .zrem(GEO_KEYS[0]!, driverId)
      .zrem(GEO_KEYS[1]!, driverId)
      .del(stateKey(driverId))
      .hset(stateKey(driverId), {
        availability: 'AVAILABLE',
        category,
        vehicleId,
        lastSeen: now,
      })
      .expire(stateKey(driverId), PRESENCE_TTL_SECONDS)
      .zadd(ONLINE_KEY, now, driverId)
      .exec();
  }

  /** Fuera de línea: se borra todo rastro de su posición (10.2, paso 5). */
  async goOffline(driverId: string): Promise<void> {
    await this.redis.client
      .multi()
      .del(stateKey(driverId))
      .zrem(GEO_KEYS[0]!, driverId)
      .zrem(GEO_KEYS[1]!, driverId)
      .zrem(ONLINE_KEY, driverId)
      .exec();
  }

  /** Al perder el socket deja de ofrecerse, pero sigue en línea hasta que caduque su estado. */
  async removeFromGeo(driverId: string): Promise<void> {
    await this.redis.client
      .multi()
      .zrem(GEO_KEYS[0]!, driverId)
      .zrem(GEO_KEYS[1]!, driverId)
      .exec();
  }

  async getAvailability(driverId: string): Promise<DriverAvailability> {
    const value = await this.redis.client.hget(stateKey(driverId), 'availability');
    return value === 'AVAILABLE' || value === 'BUSY' ? value : 'OFFLINE';
  }

  /** Valida y guarda una lectura de GPS del conductor (8.5, paso 2; 14.4). */
  async updateLocation(
    driverId: string,
    loc: DriverLocationV1,
    now = Date.now(),
  ): Promise<LocationResult> {
    if (loc.accuracy > MAX_ACCURACY_METERS) return { ok: false, code: 'LOW_ACCURACY' };
    if (loc.ts > now + MAX_FUTURE_MS || loc.ts < now - MAX_AGE_MS) {
      return { ok: false, code: 'STALE' };
    }

    const [availability, prevLat, prevLng, prevTs] = await this.redis.client.hmget(
      stateKey(driverId),
      'availability',
      'lat',
      'lng',
      'fixTs',
    );
    if (!availability) return { ok: false, code: 'OFFLINE' };

    if (loc.mocked) {
      await this.flagSuspicious(driverId, 'mocked');
      return { ok: false, code: 'IMPLAUSIBLE' };
    }
    if (prevLat && prevLng && prevTs) {
      const previousTs = Number(prevTs);
      if (loc.ts <= previousTs) return { ok: false, code: 'STALE' };
      const meters = haversineMeters({ lat: Number(prevLat), lng: Number(prevLng) }, loc);
      const speed = meters / ((loc.ts - previousTs) / 1000);
      if (meters > MIN_JUMP_METERS && speed > MAX_PLAUSIBLE_SPEED_MPS) {
        await this.flagSuspicious(driverId, 'speed');
        return { ok: false, code: 'IMPLAUSIBLE' };
      }
    }

    const updated = await this.lua.rideappUpdateLocation(
      stateKey(driverId),
      GEO_KEYS[0]!,
      GEO_KEYS[1]!,
      ONLINE_KEY,
      driverId,
      loc.lat,
      loc.lng,
      loc.heading ?? '',
      loc.speed ?? '',
      loc.ts,
      now,
      PRESENCE_TTL_SECONDS,
      isInServiceAreaBounds(loc) ? '1' : '0',
    );
    return updated === 1 ? { ok: true } : { ok: false, code: 'OFFLINE' };
  }

  /**
   * Conductores libres cerca de un punto, tal como los ve un pasajero (8.5, paso 5): sin IDs y con
   * la posición redondeada a ~100 m. Se redondea en vez de añadir ruido aleatorio, porque el ruido
   * se puede promediar con consultas repetidas.
   */
  async nearby(
    point: LatLng,
    category?: VehicleCategory,
    now = Date.now(),
  ): Promise<NearbyDriver[]> {
    if (!isInServiceAreaBounds(point)) return [];
    const categories = category ? [category] : VehicleCategory.options;
    const found: { id: string; distance: number; position: LatLng }[] = [];
    for (const cat of categories) {
      const rows = (await this.redis.client.geosearch(
        geoKey(cat),
        'FROMLONLAT',
        point.lng,
        point.lat,
        'BYRADIUS',
        NEARBY_RADIUS_KM,
        'km',
        'ASC',
        'COUNT',
        NEARBY_LIMIT,
        'WITHDIST',
        'WITHCOORD',
      )) as [string, string, [string, string]][];
      for (const [id, dist, [lng, lat]] of rows) {
        found.push({
          id,
          distance: Number(dist),
          position: { lat: Number(lat), lng: Number(lng) },
        });
      }
    }
    found.sort((a, b) => a.distance - b.distance);

    const candidates = found.slice(0, NEARBY_LIMIT);
    if (candidates.length === 0) return [];
    const pipeline = this.redis.client.pipeline();
    for (const c of candidates) {
      pipeline.zscore(ONLINE_KEY, c.id);
      pipeline.hget(stateKey(c.id), 'heading');
    }
    const results = (await pipeline.exec()) ?? [];
    const cutoff = now - PRESENCE_TTL_SECONDS * 1000;

    return candidates.flatMap((c, i) => {
      const lastSeen = Number(results[i * 2]?.[1] ?? 0);
      if (lastSeen < cutoff) return [];
      const heading = Number.parseFloat(String(results[i * 2 + 1]?.[1] ?? ''));
      return [
        {
          position: { lat: round(c.position.lat, 3), lng: round(c.position.lng, 3) },
          heading: Number.isFinite(heading) ? (Math.round(heading / 15) * 15) % 360 : null,
        },
      ];
    });
  }

  async onlineCount(now = Date.now()): Promise<number> {
    return this.redis.client.zcount(ONLINE_KEY, now - PRESENCE_TTL_SECONDS * 1000, '+inf');
  }

  /** Conductores en línea con su posición exacta: solo para el panel admin. Sin nombres. */
  async live(now = Date.now()): Promise<Omit<AdminLiveDriver, 'fullName'>[]> {
    const ids = await this.redis.client.zrangebyscore(
      ONLINE_KEY,
      now - PRESENCE_TTL_SECONDS * 1000,
      '+inf',
    );
    if (ids.length === 0) return [];
    const pipeline = this.redis.client.pipeline();
    for (const id of ids) pipeline.hgetall(stateKey(id));
    const states = (await pipeline.exec()) ?? [];
    return ids.flatMap((driverId, i) => {
      const s = (states[i]?.[1] ?? {}) as Record<string, string>;
      if (!s['availability'] || !s['category']) return [];
      const category = VehicleCategory.safeParse(s['category']);
      const heading = Number.parseFloat(s['heading'] ?? '');
      return [
        {
          driverId,
          availability: s['availability'] === 'BUSY' ? 'BUSY' : 'AVAILABLE',
          category: category.success ? category.data : 'STANDARD',
          position: s['lat'] && s['lng'] ? { lat: Number(s['lat']), lng: Number(s['lng']) } : null,
          heading: Number.isFinite(heading) ? heading : null,
          lastSeenAt: new Date(Number(s['lastSeen'])).toISOString(),
        } satisfies Omit<AdminLiveDriver, 'fullName'>,
      ];
    });
  }

  /**
   * Latido (8.5, paso 3): quita de la capa GEO y de "en línea" a quien lleva más de 60 s sin
   * enviar su ubicación. Devuelve los IDs retirados para avisarles.
   */
  async sweepInactive(now = Date.now()): Promise<string[]> {
    const cutoff = now - PRESENCE_TTL_SECONDS * 1000;
    const stale = await this.redis.client.zrangebyscore(ONLINE_KEY, '-inf', `(${cutoff}`);
    const removed: string[] = [];
    for (const id of stale) {
      const done = await this.lua.rideappSweepOne(
        stateKey(id),
        GEO_KEYS[0]!,
        GEO_KEYS[1]!,
        ONLINE_KEY,
        id,
        cutoff,
      );
      if (done === 1) removed.push(id);
    }
    return removed;
  }

  private async flagSuspicious(driverId: string, kind: 'mocked' | 'speed'): Promise<void> {
    // El contador vive con el estado (caduca con él); el log permite revisarlo después.
    // EXPIRE NX: si el estado caducó justo antes, el hash nuevo no queda sin TTL.
    await this.redis.client
      .multi()
      .hincrby(stateKey(driverId), 'suspicious', 1)
      .expire(stateKey(driverId), PRESENCE_TTL_SECONDS, 'NX')
      .exec();
    this.logger.warn({ driverId, kind }, 'Ubicación descartada por sospechosa');
  }
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
