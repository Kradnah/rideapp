import { Module } from '@nestjs/common';
import { DriversModule } from '../drivers/drivers.module.js';
import { GeoModule } from '../geo/geo.module.js';
import { LocationModule } from '../location/location.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { TripsModule } from '../trips/trips.module.js';
import { AdminDriversController } from './admin-drivers.controller.js';
import {
  AdminAuditController,
  AdminFaresController,
  AdminUsersController,
} from './admin-management.controller.js';
import { AdminTripsController } from './admin-trips.controller.js';
import { AdminUsersService } from './admin-users.service.js';
import { AdminController } from './admin.controller.js';

@Module({
  imports: [
    DriversModule,
    LocationModule,
    RealtimeModule,
    TripsModule,
    GeoModule,
    PricingModule,
    PaymentsModule,
  ],
  controllers: [
    AdminController,
    AdminDriversController,
    AdminTripsController,
    AdminUsersController,
    AdminFaresController,
    AdminAuditController,
  ],
  providers: [AdminUsersService],
})
export class AdminModule {}
