import { Controller, Get, HttpCode, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { HealthResponse } from '@rideapp/contracts';
import type { FastifyReply } from 'fastify';
import { Public } from '../../common/auth/auth.decorators.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { RedisService } from '../../infra/redis/redis.service.js';

const CHECK_TIMEOUT_MS = 1500;

async function check(fn: () => Promise<unknown>): Promise<'up' | 'down'> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS);
      }),
    ]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

/** Sondas para Dokploy/Traefik (7.5, paso 4). */
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** El proceso responde. No toca dependencias: un fallo de la BD no debe reiniciar el contenedor. */
  @Get('live')
  @HttpCode(200)
  live(): HealthResponse {
    return { status: 'ok' };
  }

  /** Listo para recibir tráfico: Postgres y Redis responden. */
  @Get('ready')
  async ready(@Res({ passthrough: true }) reply: FastifyReply): Promise<HealthResponse> {
    const [database, redis] = await Promise.all([
      check(() => this.prisma.ping()),
      check(() => this.redis.ping()),
    ]);
    const ok = database === 'up' && redis === 'up';
    void reply.status(ok ? 200 : 503);
    return { status: ok ? 'ok' : 'error', checks: { database, redis } };
  }
}
