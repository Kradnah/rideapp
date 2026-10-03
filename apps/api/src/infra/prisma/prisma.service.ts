import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { InjectEnv } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { PrismaClient } from '../../generated/prisma/client.js';

/**
 * Cliente Prisma 7 con el driver adapter de `pg`. Conecta de forma perezosa:
 * si Postgres no está disponible la app arranca igual y `/health/ready` lo refleja.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@InjectEnv() env: Env) {
    super({
      adapter: new PrismaPg({
        connectionString: env.DATABASE_URL,
        max: 10,
        // 14.1: tiempos de espera en la BD. Una consulta colgada no retiene la conexión.
        connectionTimeoutMillis: 5_000,
        statement_timeout: 10_000,
        idle_in_transaction_session_timeout: 15_000,
      }),
    });
  }

  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
