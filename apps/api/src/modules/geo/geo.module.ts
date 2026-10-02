import { Module } from '@nestjs/common';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { FakeMapsProvider } from './fake-maps.provider.js';
import { GeoController } from './geo.controller.js';
import { GeoService } from './geo.service.js';
import { GoogleMapsProvider } from './google-maps.provider.js';
import { MAPS_PROVIDER, type MapsProvider } from './maps-provider.js';

@Module({
  controllers: [GeoController],
  providers: [
    FakeMapsProvider,
    {
      provide: MAPS_PROVIDER,
      inject: [ENV, FakeMapsProvider],
      useFactory: (env: Env, fake: FakeMapsProvider): MapsProvider =>
        // EnvSchema ya exige GOOGLE_MAPS_SERVER_KEY con MAPS_PROVIDER=google.
        env.MAPS_PROVIDER === 'google' && env.GOOGLE_MAPS_SERVER_KEY
          ? new GoogleMapsProvider(env.GOOGLE_MAPS_SERVER_KEY)
          : fake,
    },
    GeoService,
  ],
  exports: [GeoService],
})
export class GeoModule {}
