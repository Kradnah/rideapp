import { Module } from '@nestjs/common';
import { LocationService } from './location.service.js';

@Module({
  providers: [LocationService],
  exports: [LocationService],
})
export class LocationModule {}
