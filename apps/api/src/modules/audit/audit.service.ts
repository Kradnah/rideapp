import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

export interface AuditEntry {
  actorId: string | null;
  /** Verbo con dominio: `auth.login`, `admin.driver_approved`… */
  action: string;
  entity: string;
  entityId?: string | null;
  ip?: string | null;
  /** Sin datos personales en claro: si hace falta identificar un email, se guarda su hash. */
  meta?: Prisma.InputJsonValue;
}

/** Registro de auditoría (8.15). Un fallo al auditar nunca rompe la operación principal. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: entry.actorId,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId ?? null,
          ip: entry.ip ?? null,
          meta: entry.meta,
        },
      });
    } catch (err) {
      this.logger.error({ err, action: entry.action }, 'No se pudo registrar la auditoría');
    }
  }
}
