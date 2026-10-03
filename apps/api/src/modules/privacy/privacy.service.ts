import { Injectable, Logger } from '@nestjs/common';
import { type DeleteMeRequest, type MeExport, SocketEvent } from '@rideapp/contracts';
import { ApiException } from '../../common/errors/api.exception.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { StorageService } from '../../infra/storage/storage.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PasswordService } from '../auth/password.service.js';
import { SessionService } from '../auth/session.service.js';
import { LocationService } from '../location/location.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { DRIVER_BUSY_STATUSES } from '../trips/trip-state.machine.js';

export const DELETED_USER_NAME = 'Usuario eliminado';

/** Actividad propia incluida en la exportación (la auditoría guarda IP 180 días como máximo). */
const EXPORT_ACTIVITY_LIMIT = 500;

/**
 * Derechos del titular (8.3, 15.2): exportar sus datos y eliminar la cuenta.
 *
 * Eliminar **anonimiza**: los viajes y pagos se conservan por la ley fiscal (15.1), pero sin nada
 * que identifique a la persona; origen y destino quedan redondeados a ~1 km y sin direcciones.
 */
@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly location: LocationService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async export(userId: string, now = new Date()): Promise<MeExport> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: {
        identities: { select: { provider: true } },
        consents: { orderBy: { acceptedAt: 'asc' } },
        refreshTokens: { orderBy: { createdAt: 'asc' } },
        pushTokens: { select: { platform: true, createdAt: true } },
        driverProfile: { include: { vehicles: true, documents: true } },
      },
    });
    if (!user) throw new ApiException(404, 'NOT_FOUND', 'No encontrado');

    const [trips, given, received, activity] = await Promise.all([
      this.prisma.trip.findMany({
        where: { OR: [{ passengerId: userId }, { driverId: userId }] },
        orderBy: { requestedAt: 'asc' },
        include: {
          payment: { select: { status: true, capturedAt: true } },
          route: { orderBy: { at: 'asc' }, select: { at: true, lat: true, lng: true } },
        },
      }),
      this.prisma.rating.findMany({ where: { fromUser: userId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.rating.findMany({ where: { toUser: userId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.auditLog.findMany({
        where: { actorId: userId },
        orderBy: { at: 'desc' },
        take: EXPORT_ACTIVITY_LIMIT,
        select: { action: true, at: true, ip: true },
      }),
    ]);

    const methods = new Set(user.identities.map((i) => i.provider.toLowerCase()));
    if (user.passwordHash) methods.add('password');
    const driver = user.driverProfile;

    await this.audit.log({
      actorId: userId,
      action: 'user.data_exported',
      entity: 'user',
      entityId: userId,
    });

    return {
      format: 'rideapp-export-v1',
      generatedAt: now.toISOString(),
      profile: {
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerified,
        fullName: user.fullName,
        phone: user.phone,
        role: user.role,
        createdAt: user.createdAt.toISOString(),
        loginMethods: [...methods].sort(),
        rating: { sum: user.ratingSum, count: user.ratingCount },
      },
      consents: user.consents.map((c) => ({
        policyVersion: c.policyVersion,
        acceptedAt: c.acceptedAt.toISOString(),
        ip: c.ip,
        channel: c.channel,
      })),
      sessions: user.refreshTokens.map((s) => ({
        createdAt: s.createdAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
        revokedAt: s.revokedAt?.toISOString() ?? null,
        ip: s.ip,
        userAgent: s.userAgent,
      })),
      driver: driver && {
        status: driver.status,
        licenseLast4: driver.licenseLast4,
        submittedAt: driver.submittedAt?.toISOString() ?? null,
        approvedAt: driver.approvedAt?.toISOString() ?? null,
        vehicles: driver.vehicles.map((v) => ({
          plate: v.plate,
          brand: v.brand,
          model: v.model,
          color: v.color,
          year: v.year,
          category: v.category,
          active: v.active,
        })),
        documents: driver.documents.map((d) => ({
          type: d.type,
          status: d.status,
          uploadedAt: d.createdAt.toISOString(),
          sha256: d.sha256,
        })),
      },
      trips: trips.map((trip) => {
        const asDriver = trip.driverId === userId;
        return {
          id: trip.id,
          as: asDriver ? 'DRIVER' : 'PASSENGER',
          status: trip.status,
          category: trip.category,
          originAddress: trip.originAddress,
          destinationAddress: trip.destinationAddress,
          origin: { lat: trip.originLat, lng: trip.originLng },
          destination: { lat: trip.destinationLat, lng: trip.destinationLng },
          distanceM: trip.distanceM,
          durationS: trip.durationS,
          amountCents: trip.amountCents,
          finalAmountCents: trip.finalAmountCents,
          currency: trip.currency,
          paymentMethod: trip.paymentMethod,
          payment: trip.payment && {
            status: trip.payment.status,
            capturedAt: trip.payment.capturedAt?.toISOString() ?? null,
          },
          requestedAt: trip.requestedAt.toISOString(),
          completedAt: trip.completedAt?.toISOString() ?? null,
          cancelledAt: trip.cancelledAt?.toISOString() ?? null,
          cancelReason: trip.cancelReason,
          // La traza es la ubicación del conductor: al pasajero no se le entrega la de otra persona.
          routePoints: asDriver
            ? trip.route.map((p) => ({ at: p.at.toISOString(), lat: p.lat, lng: p.lng }))
            : [],
        };
      }),
      ratingsGiven: given.map((r) => ({
        tripId: r.tripId,
        score: r.score,
        comment: r.comment,
        at: r.createdAt.toISOString(),
      })),
      ratingsReceived: received.map((r) => ({
        tripId: r.tripId,
        score: r.score,
        comment: r.comment,
        at: r.createdAt.toISOString(),
      })),
      pushDevices: user.pushTokens.map((p) => ({
        platform: p.platform,
        createdAt: p.createdAt.toISOString(),
      })),
      activity: activity.map((a) => ({ action: a.action, at: a.at.toISOString(), ip: a.ip })),
    };
  }

  /**
   * Elimina la cuenta (8.3, paso 2). No con un viaje en curso. Los admins no se borran desde
   * aquí (se gestionan por CLI).
   */
  async deleteAccount(
    userId: string,
    body: DeleteMeRequest,
    ip: string | null,
    now = new Date(),
  ): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: { driverProfile: { include: { documents: true } } },
    });
    if (!user) throw new ApiException(404, 'NOT_FOUND', 'No encontrado');
    if (user.role === 'ADMIN') {
      throw new ApiException(403, 'FORBIDDEN', 'Los administradores se gestionan por CLI.');
    }
    if (user.passwordHash) {
      const ok =
        body.password !== undefined &&
        (await this.passwords.verify(user.passwordHash, body.password));
      if (!ok) {
        await this.audit.log({
          actorId: userId,
          action: 'user.delete_failed',
          entity: 'user',
          entityId: userId,
          ip,
        });
        throw new ApiException(403, 'FORBIDDEN', 'La contraseña no es correcta.');
      }
    }

    const busy = await this.prisma.trip.findFirst({
      where: {
        OR: [
          {
            passengerId: userId,
            status: { in: ['REQUESTED', 'SEARCHING', ...DRIVER_BUSY_STATUSES] },
          },
          { driverId: userId, status: { in: [...DRIVER_BUSY_STATUSES] } },
        ],
      },
      select: { id: true },
    });
    if (busy) {
      throw new ApiException(
        409,
        'CONFLICT',
        'Tienes un viaje en curso. Termínalo o cancélalo primero.',
      );
    }

    const documents = user.driverProfile?.documents ?? [];
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          email: null,
          emailVerified: false,
          passwordHash: null,
          fullName: DELETED_USER_NAME,
          phone: null,
          status: 'DELETED',
          statusReason: null,
          deletedAt: now,
        },
      });
      await tx.authIdentity.deleteMany({ where: { userId } });
      await tx.emailCode.deleteMany({ where: { userId } });
      await tx.pushToken.deleteMany({ where: { userId } });
      // Las sesiones se revocan abajo (también en Redis); aquí se quitan IP y user agent.
      await tx.refreshToken.updateMany({ where: { userId }, data: { ip: null, userAgent: null } });
      await tx.rating.updateMany({ where: { fromUser: userId }, data: { comment: null } });
      await tx.fareQuote.deleteMany({ where: { passengerId: userId, trip: null } });

      // Viajes: origen y destino a ~1 km (2 decimales), sin direcciones ni ruta exacta, y sin traza.
      await tx.$executeRaw`
        UPDATE trips SET
          origin_lat = round(origin_lat::numeric, 2), origin_lng = round(origin_lng::numeric, 2),
          destination_lat = round(destination_lat::numeric, 2),
          destination_lng = round(destination_lng::numeric, 2),
          origin_address = NULL, destination_address = NULL, destination_place_id = NULL,
          polyline = '', cancel_reason = NULL, updated_at = ${now}
        WHERE passenger_id = ${userId}::uuid OR driver_id = ${userId}::uuid`;
      await tx.$executeRaw`
        UPDATE fare_quotes SET
          origin_lat = round(origin_lat::numeric, 2), origin_lng = round(origin_lng::numeric, 2),
          destination_lat = round(destination_lat::numeric, 2),
          destination_lng = round(destination_lng::numeric, 2),
          origin_address = NULL, destination_address = NULL, destination_place_id = NULL,
          polyline = ''
        WHERE id IN (SELECT quote_id FROM trips
                     WHERE passenger_id = ${userId}::uuid OR driver_id = ${userId}::uuid)`;
      await tx.$executeRaw`
        DELETE FROM trip_route_points WHERE trip_id IN (
          SELECT id FROM trips WHERE passenger_id = ${userId}::uuid OR driver_id = ${userId}::uuid)`;

      if (user.driverProfile) {
        await tx.driverDocument.deleteMany({ where: { driverId: userId } });
        await tx.vehicle.updateMany({ where: { driverId: userId }, data: { active: false } });
        await tx.driverProfile.update({
          where: { userId },
          data: { status: 'SUSPENDED', licenseNumberEnc: '', licenseLast4: '', statusReason: null },
        });
      }
    });

    // Fuera de la transacción: Redis, sockets y archivos. Si algo falla, la cuenta ya está borrada.
    await this.sessions.revokeAllForUser(userId);
    await this.notifications.forgetUser(userId);
    if (user.role === 'DRIVER') {
      await this.location.goOffline(userId);
    }
    this.realtime.emitToUser(userId, SocketEvent.SessionRevoked, { reason: 'ACCOUNT_DELETED' });
    for (const doc of documents) {
      await this.storage.delete(doc.storageKey).catch((err: unknown) => {
        this.logger.error(
          { err, documentId: doc.id },
          'No se pudo borrar el archivo de un documento',
        );
      });
    }
    await this.audit.log({
      actorId: userId,
      action: 'user.deleted',
      entity: 'user',
      entityId: userId,
      ip,
      meta: { role: user.role, documents: documents.length },
    });
  }
}
