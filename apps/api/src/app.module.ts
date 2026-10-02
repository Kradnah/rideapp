import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AuthGuard } from './common/auth/auth.guard.js';
import { loggerOptions } from './common/logging/logger.options.js';
import { ConfigModule } from './config/config.module.js';
import type { Env } from './config/env.js';
import { PrismaModule } from './infra/prisma/prisma.module.js';
import { RedisModule } from './infra/redis/redis.module.js';
import { RedisService } from './infra/redis/redis.service.js';
import { RedisThrottlerStorage } from './infra/throttler/redis-throttler.storage.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { GeoModule } from './modules/geo/geo.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { UsersModule } from './modules/users/users.module.js';

@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(env),
        LoggerModule.forRoot(loggerOptions(env)),
        PrismaModule,
        RedisModule,
        ThrottlerModule.forRootAsync({
          inject: [RedisService],
          useFactory: (redis: RedisService) => ({
            // Límite general por IP. Los endpoints de /auth tendrán límites más estrictos (8.2).
            throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
            storage: new RedisThrottlerStorage(redis),
          }),
        }),
        AuditModule,
        AuthModule,
        UsersModule,
        HealthModule,
        GeoModule,
      ],
      // Orden: primero el límite de peticiones (corta el abuso sin verificar tokens), luego la auth.
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    };
  }
}
