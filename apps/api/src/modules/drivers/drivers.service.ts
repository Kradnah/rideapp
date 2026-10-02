import { createHash, randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  type AdminDriverDetail,
  type AdminDriverList,
  type AdminDriverListQuery,
  type DriverAccount,
  type DriverAvailabilityResponse,
  type DriverDocument as DriverDocumentDto,
  type DriverDocumentType,
  type DriverOnboardingRequest,
  LOCATION_INTERVAL_SECONDS,
  MAX_VEHICLES_PER_DRIVER,
  REQUIRED_DRIVER_DOCUMENTS,
  type RevealableDriverField,
  type Vehicle as VehicleDto,
  type VehicleRequest,
} from '@rideapp/contracts';
import { FieldCrypto } from '../../common/crypto/field-crypto.js';
import { ApiException } from '../../common/errors/api.exception.js';
import {
  type DriverDocument,
  type DriverProfile,
  type DriverStatus,
  Prisma,
  type Vehicle,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { StorageService } from '../../infra/storage/storage.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AVAILABLE_INTERVAL_SECONDS, LocationService } from '../location/location.service.js';
import { UsersService } from '../users/users.service.js';
import { sanitizeDocument } from './document-file.js';

/** Mientras no esté aprobado, el conductor puede corregir sus datos (y debe reenviarlos). */
const EDITABLE: readonly DriverStatus[] = ['PENDING', 'REJECTED'];

type ProfileWithRelations = DriverProfile & { vehicles: Vehicle[]; documents: DriverDocument[] };

export function toVehicleDto(v: Vehicle): VehicleDto {
  return {
    id: v.id,
    plate: v.plate,
    brand: v.brand,
    model: v.model,
    color: v.color,
    year: v.year,
    category: v.category,
    active: v.active,
    createdAt: v.createdAt.toISOString(),
  };
}

export function toDocumentDto(d: DriverDocument): DriverDocumentDto {
  return {
    id: d.id,
    type: d.type,
    mime: d.mime as DriverDocumentDto['mime'],
    sizeBytes: d.sizeBytes,
    status: d.status,
    createdAt: d.createdAt.toISOString(),
  };
}

function missingFor(profile: ProfileWithRelations | null): DriverAccount['missing'] {
  const present = new Set(profile?.documents.map((d) => d.type));
  return {
    profile: !profile,
    vehicle: !profile?.vehicles.some((v) => v.active),
    documents: REQUIRED_DRIVER_DOCUMENTS.filter((t) => !present.has(t)),
  };
}

function isComplete(missing: DriverAccount['missing']): boolean {
  return !missing.profile && !missing.vehicle && missing.documents.length === 0;
}

/** `+57 *** *** 4567`: suficiente para reconocerlo sin exponerlo (11.1, paso 6). */
export function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  return `${phone.slice(0, 3)} *** *** ${phone.slice(-4)}`;
}

const oldestFirst = { createdAt: 'asc' } as const;

/**
 * Conductores (8.4). Servicio público del módulo: otros módulos (admin, viajes) pasan por aquí
 * y nunca tocan las tablas `driver_profiles`, `vehicles` ni `driver_documents` directamente.
 */
@Injectable()
export class DriversService {
  private readonly logger = new Logger(DriversService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: FieldCrypto,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly users: UsersService,
    private readonly location: LocationService,
  ) {}

  private findProfile(userId: string): Promise<ProfileWithRelations | null> {
    return this.prisma.driverProfile.findUnique({
      where: { userId },
      include: { vehicles: { orderBy: oldestFirst }, documents: { orderBy: oldestFirst } },
    });
  }

  /** Perfil que el conductor todavía puede modificar; si no, 404 o 409. */
  private async editableProfile(userId: string): Promise<ProfileWithRelations> {
    const profile = await this.findProfile(userId);
    if (!profile)
      throw new ApiException(404, 'NOT_FOUND', 'Completa primero tus datos de conductor');
    if (!EDITABLE.includes(profile.status)) {
      throw new ApiException(409, 'CONFLICT', 'Tu cuenta ya fue revisada: contacta a soporte');
    }
    return profile;
  }

  /** Cualquier cambio después de enviar obliga a reenviar: el admin nunca revisa datos viejos. */
  private async markChanged(userId: string): Promise<void> {
    await this.prisma.driverProfile.update({ where: { userId }, data: { submittedAt: null } });
  }

  async getAccount(userId: string): Promise<DriverAccount> {
    const profile = await this.findProfile(userId);
    return {
      status: profile?.status ?? null,
      submitted: Boolean(profile?.submittedAt),
      statusReason: profile?.statusReason ?? null,
      licenseLast4: profile?.licenseLast4 ?? null,
      vehicles: profile?.vehicles.map(toVehicleDto) ?? [],
      documents: profile?.documents.map(toDocumentDto) ?? [],
      missing: missingFor(profile),
      availability: await this.location.getAvailability(userId),
    };
  }

  async saveProfile(userId: string, body: DriverOnboardingRequest): Promise<DriverAccount> {
    const existing = await this.prisma.driverProfile.findUnique({ where: { userId } });
    if (existing && !EDITABLE.includes(existing.status)) {
      throw new ApiException(409, 'CONFLICT', 'Tu cuenta ya fue revisada: contacta a soporte');
    }
    const license = {
      licenseNumberEnc: this.crypto.encrypt(body.licenseNumber),
      licenseLast4: body.licenseNumber.slice(-4),
    };
    await this.prisma.driverProfile.upsert({
      where: { userId },
      create: { userId, ...license },
      update: { ...license, submittedAt: null },
    });
    await this.users.updateMe(userId, { phone: body.phone });
    return this.getAccount(userId);
  }

  async addVehicle(userId: string, body: VehicleRequest): Promise<VehicleDto> {
    const profile = await this.editableProfile(userId);
    if (profile.vehicles.length >= MAX_VEHICLES_PER_DRIVER) {
      throw new ApiException(409, 'CONFLICT', `Máximo ${MAX_VEHICLES_PER_DRIVER} vehículos`);
    }
    try {
      const vehicle = await this.prisma.vehicle.create({
        data: { driverId: userId, ...body, active: !profile.vehicles.some((v) => v.active) },
      });
      await this.markChanged(userId);
      return toVehicleDto(vehicle);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ApiException(409, 'CONFLICT', 'Ya registraste un vehículo con esa placa');
      }
      throw err;
    }
  }

  async listVehicles(userId: string): Promise<VehicleDto[]> {
    const vehicles = await this.prisma.vehicle.findMany({
      where: { driverId: userId },
      orderBy: oldestFirst,
    });
    return vehicles.map(toVehicleDto);
  }

  async deleteVehicle(userId: string, vehicleId: string): Promise<void> {
    await this.editableProfile(userId);
    // driverId en el filtro: un conductor nunca puede tocar el vehículo de otro (IDOR).
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, driverId: userId },
    });
    if (!vehicle) throw new ApiException(404, 'NOT_FOUND', 'Vehículo no encontrado');
    await this.prisma.$transaction(async (tx) => {
      await tx.vehicle.delete({ where: { id: vehicle.id } });
      if (vehicle.active) {
        const next = await tx.vehicle.findFirst({
          where: { driverId: userId },
          orderBy: { createdAt: 'desc' },
        });
        if (next) await tx.vehicle.update({ where: { id: next.id }, data: { active: true } });
      }
    });
    await this.markChanged(userId);
  }

  async activateVehicle(userId: string, vehicleId: string): Promise<VehicleDto> {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, driverId: userId },
    });
    if (!vehicle) throw new ApiException(404, 'NOT_FOUND', 'Vehículo no encontrado');
    if ((await this.location.getAvailability(userId)) !== 'OFFLINE') {
      throw new ApiException(409, 'CONFLICT', 'Desconéctate antes de cambiar de vehículo');
    }
    const [, updated] = await this.prisma.$transaction([
      this.prisma.vehicle.updateMany({
        where: { driverId: userId, active: true },
        data: { active: false },
      }),
      this.prisma.vehicle.update({ where: { id: vehicle.id }, data: { active: true } }),
    ]);
    return toVehicleDto(updated);
  }

  async uploadDocument(
    userId: string,
    type: DriverDocumentType,
    input: Buffer,
  ): Promise<DriverDocumentDto> {
    const profile = await this.editableProfile(userId);
    const { data, mime } = await sanitizeDocument(input);
    const storageKey = `driver-documents/${randomUUID()}`;
    await this.storage.put(storageKey, data);

    const previous = profile.documents.find((d) => d.type === type);
    const fields = {
      storageKey,
      mime,
      sizeBytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
      status: 'PENDING' as const,
      reviewedBy: null,
    };
    let doc: DriverDocument;
    try {
      doc = await this.prisma.driverDocument.upsert({
        where: { driverId_type: { driverId: userId, type } },
        create: { driverId: userId, type, ...fields },
        update: { ...fields, createdAt: new Date() },
      });
    } catch (err) {
      await this.storage.delete(storageKey);
      throw err;
    }
    // Uno vigente por tipo: el archivo anterior se borra (minimización, 15.2).
    if (previous) {
      await this.storage.delete(previous.storageKey).catch((err: unknown) => {
        this.logger.error(
          { err, documentId: previous.id },
          'No se pudo borrar el archivo anterior',
        );
      });
    }
    await this.markChanged(userId);
    return toDocumentDto(doc);
  }

  async submit(userId: string): Promise<DriverAccount> {
    const profile = await this.editableProfile(userId);
    const missing = missingFor(profile);
    if (!isComplete(missing)) {
      throw new ApiException(422, 'REQUIREMENTS_INCOMPLETE', 'Faltan datos por completar', missing);
    }
    await this.prisma.driverProfile.update({
      where: { userId },
      data: { status: 'PENDING', submittedAt: new Date() },
    });
    await this.audit.log({
      actorId: userId,
      action: 'driver.submitted',
      entity: 'driver',
      entityId: userId,
    });
    return this.getAccount(userId);
  }

  /** En línea (10.2): solo aprobado, con cuenta activa y con un vehículo activo (8.4, paso 4). */
  async goOnline(userId: string): Promise<DriverAvailabilityResponse> {
    const [user, profile] = await Promise.all([
      this.users.findActiveById(userId),
      this.findProfile(userId),
    ]);
    if (!user || user.status !== 'ACTIVE' || profile?.status !== 'APPROVED') {
      throw new ApiException(403, 'DRIVER_NOT_APPROVED', 'Tu cuenta de conductor no está aprobada');
    }
    const vehicle = profile.vehicles.find((v) => v.active);
    if (!vehicle) {
      throw new ApiException(
        422,
        'REQUIREMENTS_INCOMPLETE',
        'Elige el vehículo con el que vas a trabajar',
      );
    }
    const current = await this.location.getAvailability(userId);
    if (current === 'BUSY') {
      return { availability: 'BUSY', locationIntervalSeconds: LOCATION_INTERVAL_SECONDS.inTrip };
    }
    await this.location.goOnline(userId, { category: vehicle.category, vehicleId: vehicle.id });
    // Si tenía un viaje asignado (volvió tras cerrar la app), sigue ocupado.
    if (await this.location.currentTrip(userId)) {
      return { availability: 'BUSY', locationIntervalSeconds: LOCATION_INTERVAL_SECONDS.inTrip };
    }
    return { availability: 'AVAILABLE', locationIntervalSeconds: AVAILABLE_INTERVAL_SECONDS };
  }

  async goOffline(userId: string): Promise<DriverAvailabilityResponse> {
    if (await this.location.currentTrip(userId)) {
      // Con un viaje asignado, primero hay que terminarlo o cancelarlo.
      throw new ApiException(409, 'ACTIVE_TRIP_EXISTS', 'Tienes un viaje en curso');
    }
    await this.location.goOffline(userId);
    return { availability: 'OFFLINE', locationIntervalSeconds: AVAILABLE_INTERVAL_SECONDS };
  }

  // -------------------------------------------------------------------------------------
  // Panel admin (8.14, paso 3). Toda acción queda en auditoría.
  // -------------------------------------------------------------------------------------

  countPendingReview(): Promise<number> {
    return this.prisma.driverProfile.count({
      where: { status: 'PENDING', submittedAt: { not: null } },
    });
  }

  /** Vehículo activo del conductor (con el que se asigna un viaje). */
  async activeVehicleId(driverId: string): Promise<string | null> {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { driverId, active: true },
      select: { id: true },
    });
    return vehicle?.id ?? null;
  }

  /** Nombres de los conductores en línea, para el mapa del panel. */
  async namesById(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, fullName: true },
    });
    return new Map(users.map((u) => [u.id, u.fullName]));
  }

  async adminList(query: AdminDriverListQuery): Promise<AdminDriverList> {
    // Pendientes: solo los enviados, el más antiguo primero (cola FIFO). Resto: el más reciente.
    const pending = query.status === 'PENDING';
    const rows = await this.prisma.driverProfile.findMany({
      where: {
        ...(query.status && { status: query.status }),
        ...(pending && { submittedAt: { not: null } }),
        user: { deletedAt: null },
      },
      include: {
        user: { select: { fullName: true, email: true } },
        vehicles: { where: { active: true }, select: { plate: true, category: true } },
        _count: { select: { documents: true } },
      },
      orderBy: pending
        ? [{ submittedAt: 'asc' }, { userId: 'asc' }]
        : [{ updatedAt: 'desc' }, { userId: 'asc' }],
      take: query.limit + 1,
      ...(query.cursor && { cursor: { userId: query.cursor }, skip: 1 }),
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((p) => ({
        userId: p.userId,
        fullName: p.user.fullName,
        email: p.user.email,
        status: p.status,
        submittedAt: p.submittedAt?.toISOString() ?? null,
        createdAt: p.createdAt.toISOString(),
        vehicle: p.vehicles[0] ?? null,
        documentCount: p._count.documents,
      })),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.userId ?? null) : null,
    };
  }

  async adminDetail(driverId: string): Promise<AdminDriverDetail> {
    const profile = await this.findProfile(driverId);
    const user = profile && (await this.users.findActiveById(driverId));
    if (!profile || !user) throw new ApiException(404, 'NOT_FOUND', 'Conductor no encontrado');
    return {
      userId: user.id,
      fullName: user.fullName,
      email: user.email,
      emailVerified: user.emailVerified,
      phoneMasked: maskPhone(user.phone),
      licenseMasked: `****${profile.licenseLast4}`,
      status: profile.status,
      submitted: Boolean(profile.submittedAt),
      statusReason: profile.statusReason,
      submittedAt: profile.submittedAt?.toISOString() ?? null,
      reviewedAt: profile.reviewedAt?.toISOString() ?? null,
      createdAt: profile.createdAt.toISOString(),
      vehicles: profile.vehicles.map(toVehicleDto),
      documents: profile.documents.map(toDocumentDto),
      missing: missingFor(profile),
      availability: await this.location.getAvailability(driverId),
    };
  }

  /** Revela un dato enmascarado; cada revelación queda registrada (11.1, paso 6; 15.2, punto 7). */
  async adminReveal(
    adminId: string,
    driverId: string,
    field: RevealableDriverField,
    ip: string | null,
  ): Promise<string | null> {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId: driverId },
      include: { user: { select: { phone: true, deletedAt: true } } },
    });
    if (!profile || profile.user.deletedAt) {
      throw new ApiException(404, 'NOT_FOUND', 'Conductor no encontrado');
    }
    await this.audit.log({
      actorId: adminId,
      action: 'admin.driver_field_revealed',
      entity: 'driver',
      entityId: driverId,
      ip,
      meta: { field },
    });
    return field === 'phone' ? profile.user.phone : this.crypto.decrypt(profile.licenseNumberEnc);
  }

  /** Documento de un conductor para el admin. driverId + id: nada de documentos ajenos por URL. */
  async adminDocument(driverId: string, documentId: string): Promise<DriverDocument> {
    const doc = await this.prisma.driverDocument.findFirst({
      where: { id: documentId, driverId },
    });
    if (!doc) throw new ApiException(404, 'NOT_FOUND', 'Documento no encontrado');
    return doc;
  }

  /** Lee un documento ya autorizado (URL firmada válida). */
  async readDocument(documentId: string): Promise<{ doc: DriverDocument; data: Buffer } | null> {
    const doc = await this.prisma.driverDocument.findUnique({ where: { id: documentId } });
    if (!doc) return null;
    return { doc, data: await this.storage.get(doc.storageKey) };
  }

  /**
   * Cambia el estado con bloqueo optimista: solo si sigue en el estado esperado. Dos admins
   * decidiendo a la vez → el segundo recibe 409 en vez de pisar la decisión del primero.
   */
  private async transition(
    driverId: string,
    where: Prisma.DriverProfileWhereInput,
    data: Prisma.DriverProfileUpdateManyMutationInput,
    conflictMessage: string,
  ): Promise<void> {
    const { count } = await this.prisma.driverProfile.updateMany({
      where: { userId: driverId, user: { deletedAt: null }, ...where },
      data,
    });
    if (count === 1) return;
    const exists = await this.prisma.driverProfile.count({ where: { userId: driverId } });
    if (!exists) throw new ApiException(404, 'NOT_FOUND', 'Conductor no encontrado');
    throw new ApiException(409, 'CONFLICT', conflictMessage);
  }

  async approve(adminId: string, driverId: string, ip: string | null): Promise<void> {
    const profile = await this.findProfile(driverId);
    if (profile && !isComplete(missingFor(profile))) {
      throw new ApiException(422, 'REQUIREMENTS_INCOMPLETE', 'Al conductor le faltan datos');
    }
    const now = new Date();
    await this.transition(
      driverId,
      { status: 'PENDING', submittedAt: { not: null } },
      {
        status: 'APPROVED',
        statusReason: null,
        reviewedBy: adminId,
        reviewedAt: now,
        approvedAt: now,
      },
      'Solo se aprueban solicitudes enviadas y pendientes',
    );
    await this.prisma.driverDocument.updateMany({
      where: { driverId },
      data: { status: 'ACCEPTED', reviewedBy: adminId },
    });
    await this.audit.log({
      actorId: adminId,
      action: 'admin.driver_approved',
      entity: 'driver',
      entityId: driverId,
      ip,
    });
  }

  async reject(
    adminId: string,
    driverId: string,
    reason: string,
    ip: string | null,
  ): Promise<void> {
    await this.transition(
      driverId,
      { status: 'PENDING', submittedAt: { not: null } },
      {
        status: 'REJECTED',
        statusReason: reason,
        submittedAt: null,
        reviewedBy: adminId,
        reviewedAt: new Date(),
      },
      'Solo se rechazan solicitudes enviadas y pendientes',
    );
    await this.prisma.driverDocument.updateMany({
      where: { driverId },
      data: { status: 'REJECTED', reviewedBy: adminId },
    });
    await this.audit.log({
      actorId: adminId,
      action: 'admin.driver_rejected',
      entity: 'driver',
      entityId: driverId,
      ip,
      meta: { reason },
    });
  }

  /** Suspende y lo saca de línea al instante (el controlador le avisa por el socket). */
  async suspend(
    adminId: string,
    driverId: string,
    reason: string,
    ip: string | null,
  ): Promise<void> {
    await this.transition(
      driverId,
      { status: 'APPROVED' },
      { status: 'SUSPENDED', statusReason: reason, reviewedBy: adminId, reviewedAt: new Date() },
      'Solo se suspenden conductores aprobados',
    );
    await this.location.goOffline(driverId);
    await this.audit.log({
      actorId: adminId,
      action: 'admin.driver_suspended',
      entity: 'driver',
      entityId: driverId,
      ip,
      meta: { reason },
    });
  }

  async reactivate(adminId: string, driverId: string, ip: string | null): Promise<void> {
    await this.transition(
      driverId,
      { status: 'SUSPENDED' },
      { status: 'APPROVED', statusReason: null, reviewedBy: adminId, reviewedAt: new Date() },
      'Solo se reactivan conductores suspendidos',
    );
    await this.audit.log({
      actorId: adminId,
      action: 'admin.driver_reactivated',
      entity: 'driver',
      entityId: driverId,
      ip,
    });
  }
}
