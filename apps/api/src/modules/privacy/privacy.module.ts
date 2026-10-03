import { Module } from '@nestjs/common';
import { LocationModule } from '../location/location.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { PrivacyController } from './privacy.controller.js';
import { PrivacyService } from './privacy.service.js';
import { RetentionService } from './retention.service.js';

/** Exportar y eliminar la cuenta, y retención automática de datos (sección 15). */
@Module({
  imports: [LocationModule, RealtimeModule],
  controllers: [PrivacyController],
  providers: [PrivacyService, RetentionService],
  exports: [RetentionService],
})
export class PrivacyModule {}
