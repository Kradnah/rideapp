import { Module } from '@nestjs/common';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import { DriversModule } from '../drivers/drivers.module.js';
import { LocationModule } from '../location/location.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { DEFAULT_MATCHING_TIMINGS, MATCHING_TIMINGS, MatchingService } from './matching.service.js';
import { TripTransitions } from './trip-transitions.js';
import { DriverOfferController, TripsController } from './trips.controller.js';
import { TripsService } from './trips.service.js';

/**
 * Viajes y emparejamiento (8.8, 8.9). Viven en el mismo módulo porque se necesitan mutuamente:
 * pedir un viaje arranca la búsqueda y la búsqueda cambia el estado del viaje.
 */
@Module({
  imports: [PricingModule, DriversModule, LocationModule, RealtimeModule],
  controllers: [TripsController, DriverOfferController],
  providers: [
    TripsService,
    MatchingService,
    TripTransitions,
    IdempotencyService,
    { provide: MATCHING_TIMINGS, useValue: DEFAULT_MATCHING_TIMINGS },
  ],
  exports: [TripsService],
})
export class TripsModule {}
