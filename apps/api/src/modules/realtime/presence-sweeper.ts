import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { SocketEvent } from '@rideapp/contracts';
import { MAINTENANCE_QUEUE, QueueService } from '../../infra/queue/queue.service.js';
import { LocationService } from '../location/location.service.js';
import { RealtimeGateway } from './realtime.gateway.js';

const EVERY_MS = 30_000;

/**
 * Latido cada 30 s (8.5, paso 3; 8.15): saca de línea a los conductores sin ubicación reciente
 * y se lo dice a su app. Es un job repetible de BullMQ: con varias réplicas corre una sola vez.
 */
@Injectable()
export class PresenceSweeper implements OnModuleInit {
  private readonly logger = new Logger(PresenceSweeper.name);

  constructor(
    private readonly location: LocationService,
    private readonly realtime: RealtimeGateway,
    private readonly queues: QueueService,
  ) {}

  onModuleInit(): void {
    this.queues.every(MAINTENANCE_QUEUE, 'presence-sweep', EVERY_MS, () => this.run());
  }

  async run(now = Date.now()): Promise<string[]> {
    try {
      const removed = await this.location.sweepInactive(now);
      for (const driverId of removed) {
        this.realtime.emitToUser(driverId, SocketEvent.DriverAvailability, {
          availability: 'OFFLINE',
          reason: 'INACTIVE',
        });
      }
      return removed;
    } catch (err) {
      this.logger.warn({ err }, 'Falló el barrido de conductores inactivos');
      return [];
    }
  }
}
