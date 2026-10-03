import { z } from 'zod';
import { Paginated } from './common.js';
import { UserRole, UserStatus, VehicleCategory } from './enums.js';
import { CalendarDay, RatingAverage } from './trips.js';

/**
 * Panel admin, Fase 5 (11.1, pasos 6, 8 y 9): usuarios, tarifas y auditoría.
 * Toda acción de un admin queda en `audit_logs` (8.14, paso 6).
 */

// ---------------------------------------------------------------------------------------
// Usuarios (11.1, paso 6)
// ---------------------------------------------------------------------------------------

export const AdminUserListQuery = z.object({
  /** Busca por nombre o email (sin distinguir mayúsculas). */
  q: z.string().trim().min(2).max(100).optional(),
  role: UserRole.optional(),
  status: UserStatus.optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type AdminUserListQuery = z.infer<typeof AdminUserListQuery>;

export const UserRating = z.object({
  average: RatingAverage,
  count: z.number().int().nonnegative(),
});
export type UserRating = z.infer<typeof UserRating>;

export const AdminUserSummary = z.object({
  id: z.uuid(),
  fullName: z.string(),
  email: z.string().nullable(),
  role: UserRole,
  status: UserStatus,
  rating: UserRating,
  createdAt: z.iso.datetime(),
});
export type AdminUserSummary = z.infer<typeof AdminUserSummary>;

export const AdminUserList = Paginated(AdminUserSummary);
export type AdminUserList = z.infer<typeof AdminUserList>;

export const AdminUserDetail = AdminUserSummary.extend({
  emailVerified: z.boolean(),
  /** Enmascarado por defecto (`+57 *** *** 1234`); revelarlo queda en auditoría. */
  phoneMasked: z.string().nullable(),
  /** Motivo de la última suspensión. */
  statusReason: z.string().nullable(),
  /** Métodos con los que entra: password, google… */
  providers: z.array(z.string()),
  trips: z.object({
    completed: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
  }),
  /** Autorizaciones de tratamiento de datos (Ley 1581). */
  consents: z.array(
    z.object({
      policyVersion: z.string(),
      acceptedAt: z.iso.datetime(),
      channel: z.string(),
    }),
  ),
  /** Sesiones abiertas (refresh tokens sin revocar ni caducar). */
  activeSessions: z.number().int().nonnegative(),
});
export type AdminUserDetail = z.infer<typeof AdminUserDetail>;

/** Motivo obligatorio al suspender: queda en auditoría. */
export const AdminReasonRequest = z.strictObject({
  reason: z.string().trim().min(5).max(500),
});
export type AdminReasonRequest = z.infer<typeof AdminReasonRequest>;

// ---------------------------------------------------------------------------------------
// Tarifas (8.14, paso 5; 11.1, paso 8)
// ---------------------------------------------------------------------------------------

/** Importes en centavos, enteros y con un tope razonable (evita errores de dedo de 3 ceros). */
const FareCents = z
  .number()
  .int()
  .nonnegative()
  .max(10_000_000 * 100);

export const FareRule = z.object({
  id: z.uuid(),
  category: VehicleCategory,
  baseCents: z.number().int().nonnegative(),
  perKmCents: z.number().int().nonnegative(),
  perMinCents: z.number().int().nonnegative(),
  minFareCents: z.number().int().nonnegative(),
  currency: z.string(),
  validFrom: z.iso.datetime(),
  validTo: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  createdByName: z.string().nullable(),
  /** La que se aplica hoy en su categoría. */
  current: z.boolean(),
});
export type FareRule = z.infer<typeof FareRule>;

export const AdminFareRules = z.object({ rules: z.array(FareRule) });
export type AdminFareRules = z.infer<typeof AdminFareRules>;

/**
 * Nueva versión de una tarifa. Nunca se edita una vigente: se crea otra con su `validFrom`
 * (ahora, o en el futuro para programar un cambio). No se admiten fechas pasadas.
 */
export const CreateFareRuleRequest = z.strictObject({
  category: VehicleCategory,
  baseCents: FareCents,
  perKmCents: FareCents,
  perMinCents: FareCents,
  minFareCents: FareCents,
  validFrom: z.iso.datetime().optional(),
});
export type CreateFareRuleRequest = z.infer<typeof CreateFareRuleRequest>;

// ---------------------------------------------------------------------------------------
// Auditoría (11.1, paso 9): solo lectura
// ---------------------------------------------------------------------------------------

export const AdminAuditQuery = z.object({
  /** Prefijo de la acción, p. ej. `admin.` o `auth.login`. */
  action: z
    .string()
    .trim()
    .regex(/^[a-z_.]{2,64}$/)
    .optional(),
  actorId: z.uuid().optional(),
  entityId: z.string().trim().min(1).max(64).optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AdminAuditQuery = z.infer<typeof AdminAuditQuery>;

export const AdminAuditEntry = z.object({
  id: z.uuid(),
  at: z.iso.datetime(),
  actorId: z.uuid().nullable(),
  actorName: z.string().nullable(),
  action: z.string(),
  entity: z.string(),
  entityId: z.string().nullable(),
  ip: z.string().nullable(),
  /** Datos adicionales tal como se guardaron: se muestran como texto, nunca como HTML. */
  meta: z.unknown(),
});
export type AdminAuditEntry = z.infer<typeof AdminAuditEntry>;

export const AdminAuditList = Paginated(AdminAuditEntry);
export type AdminAuditList = z.infer<typeof AdminAuditList>;

// ---------- Informes básicos (Fase 6) ----------

export const REPORT_MAX_DAYS = 62;

/** GET /admin/reports?from&to: días de Colombia, ambos incluidos. */
export const AdminReportQuery = z
  .object({ from: CalendarDay, to: CalendarDay })
  .refine((q) => q.from <= q.to, { message: '`from` debe ser anterior o igual a `to`' })
  .refine(
    (q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 < REPORT_MAX_DAYS,
    `Como máximo ${REPORT_MAX_DAYS} días`,
  );
export type AdminReportQuery = z.infer<typeof AdminReportQuery>;

const Count = z.number().int().nonnegative();

export const AdminReportDay = z.object({
  date: CalendarDay,
  requested: Count,
  completed: Count,
  cancelled: Count,
  noDrivers: Count,
  revenueCents: Count,
});
export type AdminReportDay = z.infer<typeof AdminReportDay>;

/** Agregados sin datos personales: sirven para operar, no para vigilar a nadie (15.2). */
export const AdminReport = z.object({
  from: CalendarDay,
  to: CalendarDay,
  currency: z.string(),
  trips: z.object({
    requested: Count,
    completed: Count,
    cancelledByPassenger: Count,
    cancelledByDriver: Count,
    cancelledBySystem: Count,
    noDrivers: Count,
  }),
  revenue: z.object({ totalCents: Count, cashCents: Count, cardCents: Count }),
  /** Promedios de los viajes completados; null si no hubo. */
  averages: z.object({
    fareCents: z.number().int().nullable(),
    distanceM: z.number().int().nullable(),
    durationS: z.number().int().nullable(),
    /** De la solicitud a que un conductor acepta. */
    waitToAssignS: z.number().int().nullable(),
    rating: z.number().nullable(),
  }),
  users: z.object({ newPassengers: Count, newDrivers: Count, driversApproved: Count }),
  /** Una fila por día del rango, aunque no haya viajes. */
  days: z.array(AdminReportDay),
  /** Viajes pedidos por hora del día (0–23, hora de Colombia). */
  requestsByHour: z.array(Count).length(24),
});
export type AdminReport = z.infer<typeof AdminReport>;
