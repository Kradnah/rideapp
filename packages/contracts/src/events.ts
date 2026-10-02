import { z } from 'zod';
import { LatLng, Money } from './common.js';
import { CancelledBy, DriverAvailability, TripStatus } from './enums.js';

/**
 * Eventos Socket.IO (8.10). Nombres con dominio y versión (5.5):
 * un cambio incompatible crea `v2`, nunca modifica `v1`.
 */

export const DriverLocationV1 = z.strictObject({
  lat: LatLng.shape.lat,
  lng: LatLng.shape.lng,
  heading: z.number().min(0).max(360).nullable(),
  speed: z.number().min(0).nullable(),
  accuracy: z.number().min(0),
  ts: z.number().int().positive(),
  /** Android marca las lecturas de apps de ubicación falsa (14.4). Opcional: iOS no lo informa. */
  mocked: z.boolean().optional(),
});
export type DriverLocationV1 = z.infer<typeof DriverLocationV1>;

export const TripDriverLocationV1 = z.object({
  tripId: z.uuid(),
  position: LatLng,
  heading: z.number().min(0).max(360).nullable(),
  etaSeconds: z.number().int().nonnegative().nullable(),
  ts: z.number().int().positive(),
});
export type TripDriverLocationV1 = z.infer<typeof TripDriverLocationV1>;

export const TripOfferV1 = z.object({
  tripId: z.uuid(),
  pickupDistanceMeters: z.number().int().nonnegative(),
  /** Zona aproximada del destino, nunca la dirección exacta. */
  destinationArea: z.string(),
  amount: Money,
  expiresAt: z.iso.datetime(),
});
export type TripOfferV1 = z.infer<typeof TripOfferV1>;

export const TripOfferCancelledV1 = z.object({
  tripId: z.uuid(),
  reason: z.enum(['EXPIRED', 'TAKEN', 'CANCELLED']),
});
export type TripOfferCancelledV1 = z.infer<typeof TripOfferCancelledV1>;

export const TripStatusV1 = z.object({
  tripId: z.uuid(),
  status: TripStatus,
  previousStatus: TripStatus.nullable(),
  cancelledBy: CancelledBy.nullable(),
  at: z.iso.datetime(),
});
export type TripStatusV1 = z.infer<typeof TripStatusV1>;

/** Códigos del acuse de `driver.location.v1` cuando el servidor descarta la lectura. */
export const DriverLocationRejection = z.enum([
  'VALIDATION_FAILED',
  'FORBIDDEN',
  'RATE_LIMITED',
  'LOW_ACCURACY',
  'STALE',
  'IMPLAUSIBLE',
  'OFFLINE',
]);
export type DriverLocationRejection = z.infer<typeof DriverLocationRejection>;

/** El servidor cambió la disponibilidad del conductor por su cuenta (suspensión, inactividad). */
export const DriverAvailabilityV1 = z.object({
  availability: DriverAvailability,
  reason: z.enum(['SUSPENDED', 'INACTIVE']).nullable(),
});
export type DriverAvailabilityV1 = z.infer<typeof DriverAvailabilityV1>;

export const SessionRevokedV1 = z.object({
  reason: z.enum(['LOGOUT_ALL', 'SUSPENDED', 'TOKEN_REUSE']),
});
export type SessionRevokedV1 = z.infer<typeof SessionRevokedV1>;

export const SocketEvent = {
  DriverLocation: 'driver.location.v1',
  TripDriverLocation: 'trip.driverLocation.v1',
  TripOffer: 'trip.offer.v1',
  TripOfferCancelled: 'trip.offerCancelled.v1',
  TripStatus: 'trip.status.v1',
  SessionRevoked: 'session.revoked.v1',
  DriverAvailability: 'driver.availability.v1',
} as const;

/** Acuse de recibo genérico para eventos cliente → servidor. */
export type Ack = (res: { ok: true } | { ok: false; code: string }) => void;

export interface ServerToClientEvents {
  'trip.driverLocation.v1': (payload: TripDriverLocationV1) => void;
  'trip.offer.v1': (payload: TripOfferV1) => void;
  'trip.offerCancelled.v1': (payload: TripOfferCancelledV1) => void;
  'trip.status.v1': (payload: TripStatusV1) => void;
  'session.revoked.v1': (payload: SessionRevokedV1) => void;
  'driver.availability.v1': (payload: DriverAvailabilityV1) => void;
}

export interface ClientToServerEvents {
  'driver.location.v1': (payload: DriverLocationV1, ack?: Ack) => void;
}

/** Esquemas por evento, para validar en el servidor y en el mock. */
export const ServerToClientSchemas = {
  'trip.driverLocation.v1': TripDriverLocationV1,
  'trip.offer.v1': TripOfferV1,
  'trip.offerCancelled.v1': TripOfferCancelledV1,
  'trip.status.v1': TripStatusV1,
  'session.revoked.v1': SessionRevokedV1,
  'driver.availability.v1': DriverAvailabilityV1,
} as const satisfies Record<keyof ServerToClientEvents, z.ZodType>;

export const ClientToServerSchemas = {
  'driver.location.v1': DriverLocationV1,
} as const satisfies Record<keyof ClientToServerEvents, z.ZodType>;
