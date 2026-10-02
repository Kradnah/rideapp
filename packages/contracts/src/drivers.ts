import { z } from 'zod';
import { Phone } from './auth.js';
import { LatLng, Paginated } from './common.js';
import { DriverAvailability, DriverStatus, VehicleCategory } from './enums.js';

/**
 * Conductores (8.4): perfil, vehículos, documentos y revisión del admin.
 * Flujo: perfil → vehículo → documentos → enviar a revisión → el admin aprueba o rechaza.
 */

/** Documentos que exige la aprobación (minimización: solo lo necesario para verificar). */
export const DriverDocumentType = z.enum(['DRIVER_LICENSE', 'VEHICLE_REGISTRATION', 'SOAT']);
export type DriverDocumentType = z.infer<typeof DriverDocumentType>;
export const REQUIRED_DRIVER_DOCUMENTS = DriverDocumentType.options;

export const DriverDocumentStatus = z.enum(['PENDING', 'ACCEPTED', 'REJECTED']);
export type DriverDocumentStatus = z.infer<typeof DriverDocumentStatus>;

/** Tipos admitidos, comprobados por magic bytes en el servidor (no por la extensión). */
export const DriverDocumentMime = z.enum(['image/jpeg', 'image/png', 'application/pdf']);
export type DriverDocumentMime = z.infer<typeof DriverDocumentMime>;
export const DRIVER_DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;

export const MAX_VEHICLES_PER_DRIVER = 3;

/** Número de licencia de conducción (en Colombia suele ser el número de cédula). */
export const LicenseNumber = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[0-9A-Z-]{5,20}$/, 'Número de licencia no válido');

export const DriverOnboardingRequest = z.strictObject({
  licenseNumber: LicenseNumber,
  /** El pasajero lo necesita para contactar al conductor durante el viaje. */
  phone: Phone,
});
export type DriverOnboardingRequest = z.infer<typeof DriverOnboardingRequest>;

/** Placas colombianas: carros `ABC123`, motos `ABC12D`. Se normalizan sin espacios ni guiones. */
export const PLATE_PATTERNS = {
  STANDARD: /^[A-Z]{3}\d{3}$/,
  MOTO: /^[A-Z]{3}\d{2}[A-Z]$/,
} as const satisfies Record<VehicleCategory, RegExp>;

export const Plate = z
  .string()
  .trim()
  .toUpperCase()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^[A-Z0-9]{6}$/, 'Placa no válida'));

const MIN_VEHICLE_YEAR = 1990;

export const VehicleRequest = z
  .strictObject({
    plate: Plate,
    brand: z.string().trim().min(2).max(40),
    model: z.string().trim().min(1).max(40),
    color: z.string().trim().min(3).max(30),
    year: z
      .number()
      .int()
      .min(MIN_VEHICLE_YEAR)
      .refine((y) => y <= new Date().getFullYear() + 1, 'Año no válido'),
    category: VehicleCategory,
  })
  .superRefine((v, ctx) => {
    if (!PLATE_PATTERNS[v.category].test(v.plate)) {
      ctx.addIssue({
        code: 'custom',
        path: ['plate'],
        message: v.category === 'MOTO' ? 'Placa de moto: ABC12D' : 'Placa de carro: ABC123',
      });
    }
  });
export type VehicleRequest = z.infer<typeof VehicleRequest>;

export const Vehicle = z.object({
  id: z.uuid(),
  plate: z.string(),
  brand: z.string(),
  model: z.string(),
  color: z.string(),
  year: z.number().int(),
  category: VehicleCategory,
  /** Vehículo con el que el conductor se pone en línea (uno a la vez). */
  active: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type Vehicle = z.infer<typeof Vehicle>;

export const DriverDocument = z.object({
  id: z.uuid(),
  type: DriverDocumentType,
  mime: DriverDocumentMime,
  sizeBytes: z.number().int().positive(),
  status: DriverDocumentStatus,
  createdAt: z.iso.datetime(),
});
export type DriverDocument = z.infer<typeof DriverDocument>;

/** Estado de la cuenta de conductor (GET /drivers/me). `status` es null si aún no hay perfil. */
export const DriverAccount = z.object({
  status: DriverStatus.nullable(),
  /** true si ya se envió a revisión y está esperando al admin. */
  submitted: z.boolean(),
  /** Motivo del rechazo o de la suspensión, para mostrárselo al conductor. */
  statusReason: z.string().nullable(),
  /** Solo los 4 últimos caracteres: la licencia completa no sale del servidor. */
  licenseLast4: z.string().nullable(),
  vehicles: z.array(Vehicle),
  documents: z.array(DriverDocument),
  /** Lo que falta para poder enviar a revisión. */
  missing: z.object({
    profile: z.boolean(),
    vehicle: z.boolean(),
    documents: z.array(DriverDocumentType),
  }),
  availability: DriverAvailability,
});
export type DriverAccount = z.infer<typeof DriverAccount>;

/** Cada cuánto envía su ubicación el conductor (8.5, paso 1): libre 10–15 s, en viaje 4–5 s. */
export const LOCATION_INTERVAL_SECONDS = { available: 12, inTrip: 5 } as const;

export const DriverAvailabilityResponse = z.object({
  availability: DriverAvailability,
  /** Cada cuántos segundos debe enviar su ubicación la app (10.2, paso 3). */
  locationIntervalSeconds: z.number().int().positive(),
});
export type DriverAvailabilityResponse = z.infer<typeof DriverAvailabilityResponse>;

export const NearbyDriversQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  category: VehicleCategory.optional(),
});
export type NearbyDriversQuery = z.infer<typeof NearbyDriversQuery>;

// ---------------------------------------------------------------------------------------
// Panel admin (11.1, paso 5)
// ---------------------------------------------------------------------------------------

export const AdminDriverListQuery = z.object({
  status: DriverStatus.optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type AdminDriverListQuery = z.infer<typeof AdminDriverListQuery>;

export const AdminDriverSummary = z.object({
  userId: z.uuid(),
  fullName: z.string(),
  email: z.string().nullable(),
  status: DriverStatus,
  submittedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  vehicle: z.object({ plate: z.string(), category: VehicleCategory }).nullable(),
  documentCount: z.number().int().nonnegative(),
});
export type AdminDriverSummary = z.infer<typeof AdminDriverSummary>;

export const AdminDriverList = Paginated(AdminDriverSummary);
export type AdminDriverList = z.infer<typeof AdminDriverList>;

export const AdminDriverDetail = z.object({
  userId: z.uuid(),
  fullName: z.string(),
  email: z.string().nullable(),
  emailVerified: z.boolean(),
  /** Enmascarados por defecto; revelarlos queda en auditoría (11.1, paso 6). */
  phoneMasked: z.string().nullable(),
  licenseMasked: z.string(),
  status: DriverStatus,
  submitted: z.boolean(),
  statusReason: z.string().nullable(),
  submittedAt: z.iso.datetime().nullable(),
  reviewedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  vehicles: z.array(Vehicle),
  documents: z.array(DriverDocument),
  missing: DriverAccount.shape.missing,
  availability: DriverAvailability,
});
export type AdminDriverDetail = z.infer<typeof AdminDriverDetail>;

export const RevealableDriverField = z.enum(['phone', 'licenseNumber']);
export type RevealableDriverField = z.infer<typeof RevealableDriverField>;

export const AdminRevealRequest = z.strictObject({ field: RevealableDriverField });
export type AdminRevealRequest = z.infer<typeof AdminRevealRequest>;

export const AdminRevealResponse = z.object({ value: z.string().nullable() });
export type AdminRevealResponse = z.infer<typeof AdminRevealResponse>;

/** Motivo obligatorio al rechazar o suspender: el conductor lo ve y queda en auditoría. */
export const AdminDriverReasonRequest = z.strictObject({
  reason: z.string().trim().min(5).max(500),
});
export type AdminDriverReasonRequest = z.infer<typeof AdminDriverReasonRequest>;

/** URL firmada de corta duración para ver un documento (14.7). Ruta relativa a la base del API. */
export const SignedFileUrl = z.object({
  path: z.string().startsWith('/files/'),
  expiresAt: z.iso.datetime(),
});
export type SignedFileUrl = z.infer<typeof SignedFileUrl>;

/** Conductor en línea para el mapa del panel (11.1, paso 4). Solo el admin ve posiciones exactas. */
export const AdminLiveDriver = z.object({
  driverId: z.uuid(),
  fullName: z.string(),
  availability: DriverAvailability,
  category: VehicleCategory,
  position: LatLng.nullable(),
  heading: z.number().min(0).max(360).nullable(),
  lastSeenAt: z.iso.datetime(),
});
export type AdminLiveDriver = z.infer<typeof AdminLiveDriver>;

export const AdminLiveDrivers = z.object({ drivers: z.array(AdminLiveDriver) });
export type AdminLiveDrivers = z.infer<typeof AdminLiveDrivers>;
