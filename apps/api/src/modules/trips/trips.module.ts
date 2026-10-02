import { Module } from '@nestjs/common';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import { DriversModule } from '../drivers/drivers.module.js';
import { GeoModule } from '../geo/geo.module.js';
import { LocationModule } from '../location/location.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import {
  DEFAULT_LIVE_TRIP_TIMINGS,
  LIVE_TRIP_TIMINGS,
  LiveTripService,
} from './live-trip.service.js';
import { DEFAULT_MATCHING_TIMINGS, MATCHING_TIMINGS, MatchingService } from './matching.service.js';
import { TripTransitions } from './trip-transitions.js';
import { DriverOfferController, TripsController } from './trips.controller.js';
import { TripsService } from './trips.service.js';

/**
 * Viajes y emparejamiento (8.8, 8.9). Viven en el mismo módulo porque se necesitan mutuamente:
 * pedir un viaje arranca la búsqueda y la búsqueda cambia el estado del viaje.
 */
@Module({
  imports: [PricingModule, GeoModule, DriversModule, LocationModule, RealtimeModule],
  controllers: [TripsController, DriverOfferController],
  providers: [
    TripsService,
    MatchingService,
    TripTransitions,
    LiveTripService,
    IdempotencyService,
    { provide: MATCHING_TIMINGS, useValue: DEFAULT_MATCHING_TIMINGS },
    { provide: LIVE_TRIP_TIMINGS, useValue: DEFAULT_LIVE_TRIP_TIMINGS },
  ],
  exports: [TripsService],
})
export class TripsModule {}
