import { Injectable } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import { RedisService } from '../redis/redis.service.js';

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/**
 * Ventana fija atómica en Redis. Devuelve [hits, msHastaFinVentana, bloqueado(0|1), msHastaFinBloqueo].
 * Si `block` > 0, al superar el límite se crea una clave de bloqueo que dura `block` ms.
 */
const INCREMENT_SCRIPT = `
local hitsKey, blockKey = KEYS[1], KEYS[2]
local ttl, limit, block = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])

local blockTtl = redis.call('PTTL', blockKey)
if blockTtl > 0 then
  local hits = tonumber(redis.call('GET', hitsKey) or (limit + 1))
  return { hits, math.max(redis.call('PTTL', hitsKey), 0), 1, blockTtl }
end

local hits = redis.call('INCR', hitsKey)
if hits == 1 then redis.call('PEXPIRE', hitsKey, ttl) end
local hitsTtl = redis.call('PTTL', hitsKey)

if hits > limit then
  if block > 0 then
    redis.call('SET', blockKey, '1', 'PX', block)
    return { hits, hitsTtl, 1, block }
  end
  return { hits, hitsTtl, 1, 0 }
end
return { hits, hitsTtl, 0, 0 }
`;

/**
 * Almacenamiento del throttler en Redis (7.5, paso 8), compartido entre réplicas.
 * Sustituye a `@nest-lab/throttler-storage-redis`, que aún no soporta Nest 12.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly redis: Redis;

  constructor(redis: RedisService) {
    this.redis = redis.client;
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const base = `rl:${throttlerName}:${key}`;
    const [hits, hitsTtl, blocked, blockTtl] = (await this.redis.eval(
      INCREMENT_SCRIPT,
      2,
      `${base}:hits`,
      `${base}:block`,
      ttl,
      limit,
      blockDuration,
    )) as [number, number, number, number];

    return {
      totalHits: hits,
      timeToExpire: Math.ceil(hitsTtl / 1000),
      isBlocked: blocked === 1,
      timeToBlockExpire: Math.ceil(blockTtl / 1000),
    };
  }
}
