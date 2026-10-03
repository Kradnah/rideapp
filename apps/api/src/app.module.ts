import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AppVersionGuard } from './common/auth/app-version.guard.js';
import { AuthGuard } from './common/auth/auth.guard.js';
import { loggerOptions } from './common/logging/logger.options.js';
import { ConfigModule } from './config/config.module.js';
import type { Env } from './config/env.js';
import { MailModule } from './infra/mail/mail.module.js';
import { PrismaModule } from './infra/prisma/prisma.module.js';
import { QueueModule } from './infra/queue/queue.module.js';
import { RedisModule } from './infra/redis/redis.module.js';
import { RedisService } from './infra/redis/redis.service.js';
import { StorageModule } from './infra/storage/storage.module.js';
import { RedisThrottlerStorage } from './infra/throttler/redis-throttler.storage.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { DriversModule } from './modules/drivers/drivers.module.js';
import { GeoModule } from './modules/geo/geo.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { PricingModule } from './modules/pricing/pricing.module.js';
import { PrivacyModule } from './modules/privacy/privacy.module.js';
import { RealtimeModule } from './modules/realtime/realtime.module.js';
import { TripsModule } from './modules/trips/trips.module.js';
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
        QueueModule,
        MailModule,
        StorageModule,
        ThrottlerModule.forRootAsync({
          inject: [RedisService],
          useFactory: (redis: RedisService) => ({
            // Límite general por IP. Los endpoints de /auth tendrán límites más estrictos (8.2).
            throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
            storage: new RedisThrottlerStorage(redis),
          }),
        }),
        AuditModule,
        NotificationsModule,
        AuthModule,
        UsersModule,
        DriversModule,
        RealtimeModule,
        AdminModule,
        HealthModule,
        GeoModule,
        PricingModule,
        TripsModule,
        PrivacyModule,
      ],
      // Orden: versión mínima de la app (14.5), límite de peticiones (corta el abuso sin verificar
      // tokens) y, por último, la auth.
      providers: [
        { provide: APP_GUARD, useClass: AppVersionGuard },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    };
  }
}
