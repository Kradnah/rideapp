import { Module } from '@nestjs/common';
import { GeoModule } from '../geo/geo.module.js';
import { PricingService } from './pricing.service.js';

@Module({
  imports: [GeoModule],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
