import { Injectable } from '@nestjs/common';
import { InjectEnv } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { RedisService } from '../../infra/redis/redis.service.js';

const key = (sid: string) => `auth:revoked-sid:${sid}`;

/**
 * Sesiones revocadas, en Redis. Basta con recordarlas mientras pueda existir un access token
 * de esa sesión (su TTL): pasado ese tiempo, el refresh token ya está revocado en la BD.
 */
@Injectable()
export class SessionRevocationService {
  private readonly ttlSeconds: number;

  constructor(
    private readonly redis: RedisService,
    @InjectEnv() env: Env,
  ) {
    this.ttlSeconds = env.ACCESS_TOKEN_TTL_SECONDS + 60;
  }

  async revoke(...sids: string[]): Promise<void> {
    if (sids.length === 0) return;
    const pipeline = this.redis.client.pipeline();
    for (const sid of new Set(sids)) pipeline.set(key(sid), '1', 'EX', this.ttlSeconds);
    await pipeline.exec();
  }

  async isRevoked(sid: string): Promise<boolean> {
    return (await this.redis.client.exists(key(sid))) === 1;
  }
}
