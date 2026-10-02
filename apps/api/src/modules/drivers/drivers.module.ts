import { Module } from '@nestjs/common';
import { LocationModule } from '../location/location.module.js';
import { UsersModule } from '../users/users.module.js';
import { DocumentLinks } from './document-links.js';
import { DriversController } from './drivers.controller.js';
import { DriversService } from './drivers.service.js';
import { FilesController } from './files.controller.js';

@Module({
  imports: [UsersModule, LocationModule],
  controllers: [DriversController, FilesController],
  providers: [DriversService, DocumentLinks],
  exports: [DriversService, DocumentLinks],
})
export class DriversModule {}
