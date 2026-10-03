import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { MAINTENANCE_QUEUE, QueueService } from '../../infra/queue/queue.service.js';

const DAY_MS = 24 * 3600_000;

/** Política de retención (15.1). Documentada en docs/security.md. */
export const RETENTION = {
  /** Traza GPS de los viajes: después se borra (el viaje conserva distancia y duración). */
  routePointsDays: 90,
  /** IP en `audit_logs` (el registro se conserva, sin la IP). */
  auditIpDays: 180,
  /** Sesiones caducadas o revocadas: ya no sirven ni para detectar reutilización. */
  refreshTokensAfterExpiryDays: 7,
  /** Códigos de correo caducados o usados. */
  emailCodesDays: 1,
  /** Push tokens de teléfonos que no han abierto la app en este tiempo. */
  pushTokensIdleDays: 180,
} as const;

/** Cada 6 h: es idempotente y así no depende de la hora a la que arranque el API. */
const EVERY_MS = 6 * 3600_000;

export interface RetentionResult {
  routePoints: number;
  auditIps: number;
  refreshTokens: number;
  emailCodes: number;
  pushTokens: number;
}

/** Job de retención de datos (8.15, 15.2 punto 5). */
@Injectable()
export class RetentionService implements OnModuleInit {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
  ) {}

  onModuleInit(): void {
    this.queues.every(MAINTENANCE_QUEUE, 'data-retention', EVERY_MS, () => this.run());
  }

  async run(now = new Date()): Promise<RetentionResult> {
    const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);

    const routePoints = await this.prisma.tripRoutePoint.deleteMany({
      where: { at: { lt: ago(RETENTION.routePointsDays) } },
    });
    const auditIps = await this.prisma.auditLog.updateMany({
      where: { at: { lt: ago(RETENTION.auditIpDays) }, ip: { not: null } },
      data: { ip: null },
    });
    const refreshTokens = await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: ago(RETENTION.refreshTokensAfterExpiryDays) } },
    });
    const emailCodes = await this.prisma.emailCode.deleteMany({
      where: { expiresAt: { lt: ago(RETENTION.emailCodesDays) } },
    });
    const pushTokens = await this.prisma.pushToken.deleteMany({
      where: { lastSeenAt: { lt: ago(RETENTION.pushTokensIdleDays) } },
    });

    const result = {
      routePoints: routePoints.count,
      auditIps: auditIps.count,
      refreshTokens: refreshTokens.count,
      emailCodes: emailCodes.count,
      pushTokens: pushTokens.count,
    };
    if (Object.values(result).some((n) => n > 0)) {
      this.logger.log({ ...result }, 'Retención de datos aplicada');
    }
    return result;
  }
}
