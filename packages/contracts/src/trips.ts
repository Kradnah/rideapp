import { z } from 'zod';
import { LatLng, Money, Paginated } from './common.js';
import { CancelledBy, PaymentMethod, TripStatus, VehicleCategory } from './enums.js';

/**
 * Viajes (8.8) y emparejamiento (8.9). El precio nunca viaja del cliente al servidor:
 * se pide el viaje con el `quoteId` de una cotización propia y vigente (8.7, paso 3).
 */

export const CreateTripRequest = z.strictObject({
  quoteId: z.uuid(),
  paymentMethod: PaymentMethod,
});
export type CreateTripRequest = z.infer<typeof CreateTripRequest>;

/** Cabecera `Idempotency-Key` (8.8, paso 5): un UUID generado por la app para cada intento. */
export const IdempotencyKey = z.string().regex(/^[A-Za-z0-9-]{16,64}$/);

export const CancelTripRequest = z.strictObject({
  reason: z.string().trim().min(1).max(300).optional(),
});
export type CancelTripRequest = z.infer<typeof CancelTripRequest>;

/** Lo que ve el pasajero de su conductor una vez asignado (9.4, paso 2). */
export const TripDriverInfo = z.object({
  fullName: z.string(),
  vehicle: z.object({
    plate: z.string(),
    brand: z.string(),
    model: z.string(),
    color: z.string(),
    category: VehicleCategory,
  }),
});
export type TripDriverInfo = z.infer<typeof TripDriverInfo>;

/** Lo que ve el conductor de su pasajero, solo después de aceptar (14.4). */
export const TripPassengerInfo = z.object({
  fullName: z.string(),
});
export type TripPassengerInfo = z.infer<typeof TripPassengerInfo>;

/**
 * Un viaje visto por uno de sus participantes. Los campos de la otra parte llegan solo
 * cuando corresponde: `driver` para el pasajero, `passenger` para el conductor asignado.
 */
export const Trip = z.object({
  id: z.uuid(),
  status: TripStatus,
  category: VehicleCategory,
  paymentMethod: PaymentMethod,
  origin: LatLng,
  destination: LatLng,
  originAddress: z.string().nullable(),
  destinationAddress: z.string().nullable(),
  amount: Money,
  distanceMeters: z.number().int().nonnegative(),
  durationSeconds: z.number().int().nonnegative(),
  polyline: z.string(),
  /** PIN de 4 dígitos que el pasajero dicta al conductor para iniciar (8.8, paso 4). Solo lo ve el pasajero. */
  pin: z
    .string()
    .regex(/^\d{4}$/)
    .nullable(),
  requestedAt: z.iso.datetime(),
  acceptedAt: z.iso.datetime().nullable(),
  cancelledAt: z.iso.datetime().nullable(),
  cancelledBy: CancelledBy.nullable(),
  cancelReason: z.string().nullable(),
  driver: TripDriverInfo.nullable(),
  passenger: TripPassengerInfo.nullable(),
});
export type Trip = z.infer<typeof Trip>;

/** GET /trips/active: para retomar el viaje al abrir la app o reconectar (8.8, paso 3). */
export const ActiveTripResponse = z.object({ trip: Trip.nullable() });
export type ActiveTripResponse = z.infer<typeof ActiveTripResponse>;

/**
 * Oferta pendiente del conductor (GET /drivers/me/offer), por si la app perdió el evento
 * `trip.offer.v1` (estaba en segundo plano o reconectando). Misma forma que el evento.
 */
export const DriverOffer = z.object({
  tripId: z.uuid(),
  pickupDistanceMeters: z.number().int().nonnegative(),
  /** Zona aproximada de la recogida y del destino, nunca la dirección exacta (14.4). */
  pickupArea: z.string(),
  destinationArea: z.string(),
  amount: Money,
  paymentMethod: PaymentMethod,
  expiresAt: z.iso.datetime(),
});
export type DriverOffer = z.infer<typeof DriverOffer>;

export const DriverOfferResponse = z.object({ offer: DriverOffer.nullable() });
export type DriverOfferResponse = z.infer<typeof DriverOfferResponse>;

// ---------------------------------------------------------------------------------------
// Panel admin (11.1, paso 7)
// ---------------------------------------------------------------------------------------

/** Filtros del listado: un estado concreto o grupos útiles para operar. */
export const AdminTripFilter = z.enum(['ACTIVE', 'FINISHED', ...TripStatus.options]);
export type AdminTripFilter = z.infer<typeof AdminTripFilter>;

export const AdminTripListQuery = z.object({
  status: AdminTripFilter.optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type AdminTripListQuery = z.infer<typeof AdminTripListQuery>;

export const AdminTripSummary = z.object({
  id: z.uuid(),
  status: TripStatus,
  category: VehicleCategory,
  passengerName: z.string(),
  driverName: z.string().nullable(),
  originAddress: z.string().nullable(),
  destinationAddress: z.string().nullable(),
  amount: Money,
  requestedAt: z.iso.datetime(),
});
export type AdminTripSummary = z.infer<typeof AdminTripSummary>;

export const AdminTripList = Paginated(AdminTripSummary);
export type AdminTripList = z.infer<typeof AdminTripList>;

export const TripEventActor = z.enum(['PASSENGER', 'DRIVER', 'SYSTEM', 'ADMIN']);
export type TripEventActor = z.infer<typeof TripEventActor>;

/** Línea de tiempo del viaje (`trip_events`). */
export const AdminTripEvent = z.object({
  fromStatus: TripStatus.nullable(),
  toStatus: TripStatus,
  actor: TripEventActor,
  at: z.iso.datetime(),
});
export type AdminTripEvent = z.infer<typeof AdminTripEvent>;

export const AdminTripDetail = Trip.omit({ driver: true, passenger: true, pin: true }).extend({
  passenger: z.object({ id: z.uuid(), fullName: z.string() }),
  driver: z
    .object({
      id: z.uuid(),
      fullName: z.string(),
      vehicle: TripDriverInfo.shape.vehicle.nullable(),
    })
    .nullable(),
  /** Conductores que rechazaron la oferta o la dejaron caducar. */
  offersDeclined: z.number().int().nonnegative(),
  events: z.array(AdminTripEvent),
});
export type AdminTripDetail = z.infer<typeof AdminTripDetail>;
