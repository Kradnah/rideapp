import { Module } from '@nestjs/common';
import { DriversModule } from '../drivers/drivers.module.js';
import { LocationModule } from '../location/location.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { AdminDriversController } from './admin-drivers.controller.js';
import { AdminController } from './admin.controller.js';

@Module({
  imports: [DriversModule, LocationModule, RealtimeModule],
  controllers: [AdminController, AdminDriversController],
})
export class AdminModule {}
