import { Injectable, Logger } from '@nestjs/common';
import type { AdminAuditList, AdminAuditQuery } from '@rideapp/contracts';
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

  /** Auditoría en el panel (11.1, paso 9): solo lectura, la más reciente primero. */
  async list(query: AdminAuditQuery): Promise<AdminAuditList> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(query.action && { action: { startsWith: query.action } }),
        ...(query.actorId && { actorId: query.actorId }),
        ...(query.entityId && { entityId: query.entityId }),
      },
      // uuid v7: ordenar por id es ordenar por fecha.
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
    });
    const page = rows.slice(0, query.limit);
    const actorIds = [...new Set(page.flatMap((r) => (r.actorId ? [r.actorId] : [])))];
    const actors = await this.prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, fullName: true },
    });
    const names = new Map(actors.map((a) => [a.id, a.fullName]));
    return {
      items: page.map((r) => ({
        id: r.id,
        at: r.at.toISOString(),
        actorId: r.actorId,
        actorName: r.actorId ? (names.get(r.actorId) ?? null) : null,
        action: r.action,
        entity: r.entity,
        entityId: r.entityId,
        ip: r.ip,
        meta: r.meta ?? null,
      })),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }
}
