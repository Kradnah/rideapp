import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { InjectEnv } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';

/**
 * Clientes Redis (8.1, paso 6): uno para comandos y otros dedicados para pub/sub,
 * porque una conexión suscrita no puede ejecutar comandos normales.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;
  private readonly extra: Redis[] = [];

  constructor(@InjectEnv() private readonly env: Env) {
    this.client = this.create('commands');
  }

  /** Conexión nueva para suscripciones (adaptador de Socket.IO, BullMQ...). */
  createSubscriber(name: string): Redis {
    const sub = this.create(name);
    this.extra.push(sub);
    return sub;
  }

  async ping(): Promise<void> {
    const res = await this.client.ping();
    if (res !== 'PONG') throw new Error(`Respuesta inesperada de Redis: ${res}`);
  }

  private create(name: string): Redis {
    const redis = new Redis(this.env.REDIS_URL, {
      connectionName: `rideapp-api:${name}`,
      maxRetriesPerRequest: 2,
      lazyConnect: false,
      // 14.1: ninguna petición espera indefinidamente si Redis se cuelga.
      connectTimeout: 5_000,
      commandTimeout: 5_000,
    });
    // Sin este listener, ioredis registra cada fallo de reconexión como "Unhandled error event".
    redis.on('error', (err: Error) => this.logger.warn(`Redis (${name}): ${err.message}`));
    return redis;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.client, ...this.extra].map((r) => r.quit()));
  }
}
