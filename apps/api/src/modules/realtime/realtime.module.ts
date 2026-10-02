import { Module } from '@nestjs/common';
import { LocationModule } from '../location/location.module.js';
import { PresenceSweeper } from './presence-sweeper.js';
import { RealtimeGateway } from './realtime.gateway.js';

@Module({
  imports: [LocationModule],
  providers: [RealtimeGateway, PresenceSweeper],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
