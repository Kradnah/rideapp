import { Injectable } from '@nestjs/common';
import {
  type AdminUserDetail,
  type AdminUserList,
  type AdminUserListQuery,
  type AdminUserSummary,
  SocketEvent,
} from '@rideapp/contracts';
import { ApiException } from '../../common/errors/api.exception.js';
import type { Prisma, User } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { SessionService } from '../auth/session.service.js';
import { maskPhone } from '../drivers/drivers.service.js';
import { LocationService } from '../location/location.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { ratingAverage } from '../trips/ratings.service.js';
import { DRIVER_BUSY_STATUSES } from '../trips/trip-state.machine.js';

function toSummary(user: User): AdminUserSummary {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    status: user.status,
    rating: { average: ratingAverage(user.ratingSum, user.ratingCount), count: user.ratingCount },
    createdAt: user.createdAt.toISOString(),
  };
}

/**
 * Usuarios en el panel (11.1, paso 6): búsqueda, detalle con datos enmascarados y suspensión.
 * Cada acción queda en auditoría. Los admins no se suspenden desde el panel.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly location: LocationService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
  ) {}

  async list(query: AdminUserListQuery): Promise<AdminUserList> {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(query.role && { role: query.role }),
      ...(query.status && { status: query.status }),
      ...(query.q && {
        OR: [
          { fullName: { contains: query.q, mode: 'insensitive' } },
          { email: { contains: query.q } }, // citext: ya no distingue mayúsculas
        ],
      }),
    };
    const rows = await this.prisma.user.findMany({
      where,
      // uuid v7: el más reciente primero.
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(toSummary),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async detail(id: string, now = new Date()): Promise<AdminUserDetail> {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: {
        identities: { select: { provider: true } },
        consents: { orderBy: { acceptedAt: 'desc' }, take: 10 },
      },
    });
    if (!user) throw new ApiException(404, 'NOT_FOUND', 'Usuario no encontrado');
    const own: Prisma.TripWhereInput =
      user.role === 'DRIVER' ? { driverId: id } : { passengerId: id };
    const [completed, cancelled, activeSessions] = await Promise.all([
      this.prisma.trip.count({ where: { ...own, status: 'COMPLETED' } }),
      this.prisma.trip.count({ where: { ...own, status: 'CANCELLED' } }),
      this.prisma.refreshToken.count({
        where: { userId: id, revokedAt: null, expiresAt: { gt: now } },
      }),
    ]);
    const providers = new Set(user.identities.map((i) => i.provider.toLowerCase()));
    if (user.passwordHash) providers.add('password');
    return {
      ...toSummary(user),
      emailVerified: user.emailVerified,
      phoneMasked: maskPhone(user.phone),
      statusReason: user.statusReason,
      providers: [...providers].sort(),
      trips: { completed, cancelled },
      consents: user.consents.map((c) => ({
        policyVersion: c.policyVersion,
        acceptedAt: c.acceptedAt.toISOString(),
        channel: c.channel,
      })),
      activeSessions,
    };
  }

  /** Revelar el teléfono queda registrado (11.1, paso 6; 15.2, punto 7). */
  async revealPhone(adminId: string, id: string, ip: string | null): Promise<string | null> {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: { phone: true },
    });
    if (!user) throw new ApiException(404, 'NOT_FOUND', 'Usuario no encontrado');
    await this.audit.log({
      actorId: adminId,
      action: 'admin.user_field_revealed',
      entity: 'user',
      entityId: id,
      ip,
      meta: { field: 'phone' },
    });
    return user.phone;
  }

  /**
   * Suspender: no puede entrar ni renovar su sesión; se cierran todas sus sesiones, se le
   * desconecta del socket y, si es conductor, sale de línea. No con un viaje en curso: primero
   * hay que cancelarlo.
   */
  async suspend(adminId: string, id: string, reason: string, ip: string | null): Promise<void> {
    const user = await this.findManageable(id);
    const busy = await this.prisma.trip.findFirst({
      where: {
        OR: [
          { passengerId: id, status: { in: ['REQUESTED', 'SEARCHING', ...DRIVER_BUSY_STATUSES] } },
          { driverId: id, status: { in: [...DRIVER_BUSY_STATUSES] } },
        ],
      },
      select: { id: true },
    });
    if (busy) {
      throw new ApiException(409, 'CONFLICT', 'Tiene un viaje en curso. Espera a que termine.');
    }
    const { count } = await this.prisma.user.updateMany({
      where: { id, status: 'ACTIVE' },
      data: { status: 'SUSPENDED', statusReason: reason },
    });
    if (count === 0) throw new ApiException(409, 'CONFLICT', 'El usuario no está activo.');

    const sessions = await this.sessions.revokeAllForUser(id);
    await this.notifications.forgetUser(id);
    if (user.role === 'DRIVER') {
      await this.location.goOffline(id);
      this.realtime.emitToUser(id, SocketEvent.DriverAvailability, {
        availability: 'OFFLINE',
        reason: 'SUSPENDED',
      });
    }
    this.realtime.emitToUser(id, SocketEvent.SessionRevoked, { reason: 'SUSPENDED' });
    await this.audit.log({
      actorId: adminId,
      action: 'admin.user_suspended',
      entity: 'user',
      entityId: id,
      ip,
      meta: { reason, sessions },
    });
  }

  async reactivate(adminId: string, id: string, ip: string | null): Promise<void> {
    await this.findManageable(id);
    const { count } = await this.prisma.user.updateMany({
      where: { id, status: 'SUSPENDED' },
      data: { status: 'ACTIVE', statusReason: null },
    });
    if (count === 0) throw new ApiException(409, 'CONFLICT', 'El usuario no está suspendido.');
    await this.audit.log({
      actorId: adminId,
      action: 'admin.user_reactivated',
      entity: 'user',
      entityId: id,
      ip,
    });
  }

  private async findManageable(id: string): Promise<User> {
    const user = await this.prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!user) throw new ApiException(404, 'NOT_FOUND', 'Usuario no encontrado');
    if (user.role === 'ADMIN') {
      throw new ApiException(403, 'FORBIDDEN', 'Los administradores se gestionan por CLI.');
    }
    return user;
  }
}
