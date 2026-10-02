import { Module } from '@nestjs/common';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { FakeMapsProvider } from './fake-maps.provider.js';
import { MAPS_PROVIDER, type MapsProvider } from './maps-provider.js';

@Module({
  providers: [
    FakeMapsProvider,
    {
      provide: MAPS_PROVIDER,
      inject: [ENV, FakeMapsProvider],
      useFactory: (env: Env, fake: FakeMapsProvider): MapsProvider => {
        if (env.MAPS_PROVIDER === 'google') {
          // Se implementa en la Fase 3 (8.6), junto con cuotas por usuario y caché.
          throw new Error('GoogleMapsProvider aún no está implementado: usa MAPS_PROVIDER=fake');
        }
        return fake;
      },
    },
  ],
  exports: [MAPS_PROVIDER],
})
export class GeoModule {}
