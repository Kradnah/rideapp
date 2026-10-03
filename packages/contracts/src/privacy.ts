import { z } from 'zod';
import { Password } from './auth.js';
import {
  DriverStatus,
  PaymentMethod,
  PaymentStatus,
  TripStatus,
  UserRole,
  VehicleCategory,
} from './enums.js';

/**
 * Derechos del titular (15.2, punto 4): exportar (`GET /me/export`) y eliminar (`DELETE /me`).
 *
 * Eliminar exige la contraseña si la cuenta tiene una (un access token robado no basta para
 * borrar la cuenta); las cuentas solo con Google confirman escribiendo la palabra.
 */
export const DELETE_ACCOUNT_CONFIRMATION = 'ELIMINAR';

export const DeleteMeRequest = z.strictObject({
  confirmation: z.literal(DELETE_ACCOUNT_CONFIRMATION),
  password: Password.optional(),
});
export type DeleteMeRequest = z.infer<typeof DeleteMeRequest>;

const IsoDate = z.iso.datetime();

export const MeExportTrip = z.object({
  id: z.uuid(),
  /** Papel del titular en el viaje. */
  as: z.enum(['PASSENGER', 'DRIVER']),
  status: TripStatus,
  category: VehicleCategory,
  originAddress: z.string().nullable(),
  destinationAddress: z.string().nullable(),
  origin: z.object({ lat: z.number(), lng: z.number() }),
  destination: z.object({ lat: z.number(), lng: z.number() }),
  distanceM: z.number().int(),
  durationS: z.number().int(),
  amountCents: z.number().int(),
  finalAmountCents: z.number().int().nullable(),
  currency: z.string(),
  paymentMethod: PaymentMethod,
  payment: z.object({ status: PaymentStatus, capturedAt: IsoDate.nullable() }).nullable(),
  requestedAt: IsoDate,
  completedAt: IsoDate.nullable(),
  cancelledAt: IsoDate.nullable(),
  cancelReason: z.string().nullable(),
  /** Traza GPS: solo en los viajes del conductor (es su propia ubicación) y mientras se conserve. */
  routePoints: z.array(z.object({ at: IsoDate, lat: z.number(), lng: z.number() })),
});
export type MeExportTrip = z.infer<typeof MeExportTrip>;

export const MeExport = z.object({
  format: z.literal('rideapp-export-v1'),
  generatedAt: IsoDate,
  profile: z.object({
    id: z.uuid(),
    email: z.string().nullable(),
    emailVerified: z.boolean(),
    fullName: z.string(),
    phone: z.string().nullable(),
    role: UserRole,
    createdAt: IsoDate,
    loginMethods: z.array(z.string()),
    rating: z.object({ sum: z.number().int(), count: z.number().int() }),
  }),
  consents: z.array(
    z.object({
      policyVersion: z.string(),
      acceptedAt: IsoDate,
      ip: z.string().nullable(),
      channel: z.string(),
    }),
  ),
  sessions: z.array(
    z.object({
      createdAt: IsoDate,
      expiresAt: IsoDate,
      revokedAt: IsoDate.nullable(),
      ip: z.string().nullable(),
      userAgent: z.string().nullable(),
    }),
  ),
  driver: z
    .object({
      status: DriverStatus,
      licenseLast4: z.string(),
      submittedAt: IsoDate.nullable(),
      approvedAt: IsoDate.nullable(),
      vehicles: z.array(
        z.object({
          plate: z.string(),
          brand: z.string(),
          model: z.string(),
          color: z.string(),
          year: z.number().int(),
          category: VehicleCategory,
          active: z.boolean(),
        }),
      ),
      /** Solo los metadatos: los archivos se piden por el canal de consultas (15). */
      documents: z.array(
        z.object({ type: z.string(), status: z.string(), uploadedAt: IsoDate, sha256: z.string() }),
      ),
    })
    .nullable(),
  trips: z.array(MeExportTrip),
  ratingsGiven: z.array(
    z.object({
      tripId: z.uuid(),
      score: z.number().int(),
      comment: z.string().nullable(),
      at: IsoDate,
    }),
  ),
  /** Calificaciones recibidas sin identificar a quien califica. */
  ratingsReceived: z.array(
    z.object({
      tripId: z.uuid(),
      score: z.number().int(),
      comment: z.string().nullable(),
      at: IsoDate,
    }),
  ),
  pushDevices: z.array(z.object({ platform: z.string(), createdAt: IsoDate })),
  activity: z.array(z.object({ action: z.string(), at: IsoDate, ip: z.string().nullable() })),
});
export type MeExport = z.infer<typeof MeExport>;
