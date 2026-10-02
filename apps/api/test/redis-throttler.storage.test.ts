import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RedisService } from '../src/infra/redis/redis.service.js';
import { RedisThrottlerStorage } from '../src/infra/throttler/redis-throttler.storage.js';

/**
 * Necesita un Redis real: `pnpm infra:up` y luego
 *   REDIS_TEST_URL=redis://:<contraseña>@127.0.0.1:6379/15 pnpm --filter @rideapp/api test
 * Usa la base 15 y la vacía al terminar. Sin la variable, se omite.
 */
const url = process.env['REDIS_TEST_URL'];

describe.skipIf(!url)('RedisThrottlerStorage (Redis real)', () => {
  let redis: Redis;
  let storage: RedisThrottlerStorage;

  beforeAll(async () => {
    redis = new Redis(url!);
    await redis.flushdb();
    storage = new RedisThrottlerStorage({ client: redis } as unknown as RedisService);
  });

  afterAll(async () => {
    await redis.flushdb();
    await redis.quit();
  });

  it('cuenta dentro de la ventana y bloquea al superar el límite', async () => {
    const key = `t-${Date.now()}`;
    const r1 = await storage.increment(key, 1000, 2, 0, 'default');
    const r2 = await storage.increment(key, 1000, 2, 0, 'default');
    const r3 = await storage.increment(key, 1000, 2, 0, 'default');
    expect([r1.totalHits, r2.totalHits, r3.totalHits]).toEqual([1, 2, 3]);
    expect([r1.isBlocked, r2.isBlocked, r3.isBlocked]).toEqual([false, false, true]);
    expect(r1.timeToExpire).toBeLessThanOrEqual(1);
  });

  it('mantiene el bloqueo durante blockDuration aunque expire la ventana', async () => {
    const key = `b-${Date.now()}`;
    await storage.increment(key, 200, 1, 1500, 'default');
    const blocked = await storage.increment(key, 200, 1, 1500, 'default');
    expect(blocked.isBlocked).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    const still = await storage.increment(key, 200, 1, 1500, 'default');
    expect(still.isBlocked).toBe(true);
    expect(still.timeToBlockExpire).toBeGreaterThan(0);
  });

  it('la ventana se reinicia al expirar', async () => {
    const key = `w-${Date.now()}`;
    await storage.increment(key, 150, 1, 0, 'default');
    await new Promise((r) => setTimeout(r, 250));
    const fresh = await storage.increment(key, 150, 1, 0, 'default');
    expect(fresh.totalHits).toBe(1);
    expect(fresh.isBlocked).toBe(false);
  });
});
