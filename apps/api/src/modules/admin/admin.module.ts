import { Module } from '@nestjs/common';
import { DriversModule } from '../drivers/drivers.module.js';
import { GeoModule } from '../geo/geo.module.js';
import { LocationModule } from '../location/location.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { TripsModule } from '../trips/trips.module.js';
import { AdminDriversController } from './admin-drivers.controller.js';
import { AdminTripsController } from './admin-trips.controller.js';
import { AdminController } from './admin.controller.js';

@Module({
  imports: [DriversModule, LocationModule, RealtimeModule, TripsModule, GeoModule],
  controllers: [AdminController, AdminDriversController, AdminTripsController],
})
export class AdminModule {}
