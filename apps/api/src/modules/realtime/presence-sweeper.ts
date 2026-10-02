import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { SocketEvent } from '@rideapp/contracts';
import { RedisService } from '../../infra/redis/redis.service.js';
import { LocationService } from '../location/location.service.js';
import { RealtimeGateway } from './realtime.gateway.js';

const EVERY_MS = 30_000;
const LOCK_KEY = 'lock:presence-sweeper';

/**
 * Latido cada 30 s (8.5, paso 3; 8.15): saca de línea a los conductores sin ubicación reciente
 * y se lo dice a su app. Con varias réplicas, un lock en Redis evita que corra dos veces.
 * Se pasará a un job repetible de BullMQ cuando existan las colas (Fase 3).
 */
@Injectable()
export class PresenceSweeper implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PresenceSweeper.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly location: LocationService,
    private readonly realtime: RealtimeGateway,
    private readonly redis: RedisService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.run(), EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(now = Date.now()): Promise<string[]> {
    try {
      const lock = await this.redis.client.set(LOCK_KEY, '1', 'PX', EVERY_MS - 5_000, 'NX');
      if (lock !== 'OK') return [];
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
