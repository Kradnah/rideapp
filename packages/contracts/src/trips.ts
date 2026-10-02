import { z } from 'zod';
import { LatLng, Money, Paginated } from './common.js';
import { CancelledBy, PaymentMethod, PaymentStatus, TripStatus, VehicleCategory } from './enums.js';

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

/** POST /trips/:id/start: el conductor inicia con el PIN que le dicta el pasajero (8.8, paso 4). */
export const StartTripRequest = z.strictObject({
  pin: z.string().regex(/^\d{4}$/),
});
export type StartTripRequest = z.infer<typeof StartTripRequest>;

/** Promedio de calificaciones (8.12) con un decimal; null si aún no tiene ninguna. */
export const RatingAverage = z.number().min(1).max(5).nullable();

/** Lo que ve el pasajero de su conductor una vez asignado (9.4, paso 2). */
export const TripDriverInfo = z.object({
  fullName: z.string(),
  rating: RatingAverage,
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
  rating: RatingAverage,
});
export type TripPassengerInfo = z.infer<typeof TripPassengerInfo>;

/** Plazo para calificar un viaje completado (8.12, paso 1). */
export const RATING_WINDOW_DAYS = 7;
export const RATING_COMMENT_MAX = 500;

/** Pago del viaje (8.11). Efectivo: PENDING hasta que el conductor confirma el cobro. */
export const TripPayment = z.object({
  method: PaymentMethod,
  status: PaymentStatus,
  amount: Money,
  paidAt: z.iso.datetime().nullable(),
});
export type TripPayment = z.infer<typeof TripPayment>;

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
  arrivedAt: z.iso.datetime().nullable(),
  startedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
  cancelledAt: z.iso.datetime().nullable(),
  cancelledBy: CancelledBy.nullable(),
  cancelReason: z.string().nullable(),
  driver: TripDriverInfo.nullable(),
  passenger: TripPassengerInfo.nullable(),
  /** Existe desde que el viaje se completa. */
  payment: TripPayment.nullable(),
  /** La calificación que dio quien consulta; null si aún no calificó. */
  myRating: z.number().int().min(1).max(5).nullable(),
  /** Hasta cuándo puede calificar quien consulta; null si ya calificó o no corresponde. */
  rateableUntil: z.iso.datetime().nullable(),
});
export type Trip = z.infer<typeof Trip>;

/** POST /trips/:id/rating (8.12): una vez por participante, solo con el viaje completado. */
export const RateTripRequest = z.strictObject({
  score: z.number().int().min(1).max(5),
  comment: z
    .string()
    .trim()
    .max(RATING_COMMENT_MAX)
    // Texto plano sin caracteres de control: se muestra al admin.
    // eslint-disable-next-line no-control-regex
    .transform((v) => v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' '))
    .optional(),
});
export type RateTripRequest = z.infer<typeof RateTripRequest>;

// ---------------------------------------------------------------------------------------
// Historial (9.5, paso 3) y ganancias del conductor (10.4)
// ---------------------------------------------------------------------------------------

export const TripHistoryQuery = z.object({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type TripHistoryQuery = z.infer<typeof TripHistoryQuery>;

/** Un viaje terminado (completado o cancelado) en el historial propio. */
export const TripHistoryItem = z.object({
  id: z.uuid(),
  status: TripStatus,
  category: VehicleCategory,
  paymentMethod: PaymentMethod,
  originAddress: z.string().nullable(),
  destinationAddress: z.string().nullable(),
  amount: Money,
  requestedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  /** El conductor (para el pasajero) o el pasajero (para el conductor). */
  counterpartName: z.string().nullable(),
  myRating: z.number().int().min(1).max(5).nullable(),
});
export type TripHistoryItem = z.infer<typeof TripHistoryItem>;

export const TripHistory = Paginated(TripHistoryItem);
export type TripHistory = z.infer<typeof TripHistory>;

/** Día calendario (YYYY-MM-DD) en hora de Colombia. */
export const CalendarDay = z.iso.date();

export const EARNINGS_MAX_DAYS = 62;

/** GET /drivers/me/earnings?from&to: días de Colombia, ambos incluidos. */
export const DriverEarningsQuery = z
  .object({ from: CalendarDay, to: CalendarDay })
  .refine((q) => q.from <= q.to, { message: '`from` debe ser anterior o igual a `to`' })
  .refine(
    (q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 < EARNINGS_MAX_DAYS,
    `Como máximo ${EARNINGS_MAX_DAYS} días`,
  );
export type DriverEarningsQuery = z.infer<typeof DriverEarningsQuery>;

export const DriverEarnings = z.object({
  from: CalendarDay,
  to: CalendarDay,
  trips: z.number().int().nonnegative(),
  total: Money,
  /** Cobrado en efectivo por el conductor. */
  cash: Money,
  /** Pagado con tarjeta (demo): en producción lo liquidaría la plataforma. */
  card: Money,
  /** Solo los días con viajes. */
  days: z.array(
    z.object({
      date: CalendarDay,
      trips: z.number().int().nonnegative(),
      amountCents: z.number().int().nonnegative(),
    }),
  ),
  rating: z.object({ average: RatingAverage, count: z.number().int().nonnegative() }),
});
export type DriverEarnings = z.infer<typeof DriverEarnings>;

/** GET /trips/active: para retomar el viaje al abrir la app o reconectar (8.8, paso 3). */
export const ActiveTripResponse = z.object({ trip: Trip.nullable() });
export type ActiveTripResponse = z.infer<typeof ActiveTripResponse>;

/**
 * GET /trips/:id/driver-location: la última posición del conductor asignado, para pintarla al
 * abrir la pantalla sin esperar al siguiente `trip.driverLocation.v1`. Solo para el pasajero y
 * solo mientras el viaje está activo (14.4). Misma forma que el evento.
 */
export const TripDriverLocation = z.object({
  tripId: z.uuid(),
  position: LatLng,
  heading: z.number().min(0).max(360).nullable(),
  /** Segundos estimados hasta la recogida (o hasta el destino, en viaje); null si ya llegó. */
  etaSeconds: z.number().int().nonnegative().nullable(),
  ts: z.number().int().positive(),
});
export type TripDriverLocation = z.infer<typeof TripDriverLocation>;

export const TripDriverLocationResponse = z.object({ location: TripDriverLocation.nullable() });
export type TripDriverLocationResponse = z.infer<typeof TripDriverLocationResponse>;

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

export const AdminTripRating = z.object({
  by: z.enum(['PASSENGER', 'DRIVER']),
  score: z.number().int().min(1).max(5),
  comment: z.string().nullable(),
  at: z.iso.datetime(),
});
export type AdminTripRating = z.infer<typeof AdminTripRating>;

export const AdminTripDetail = Trip.omit({
  driver: true,
  passenger: true,
  pin: true,
  myRating: true,
  rateableUntil: true,
}).extend({
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
  /** Traza muestreada del conductor durante el viaje (`trip_route_points`, ~1 punto / 10 s). */
  trace: z.array(LatLng),
  /** Posición en vivo del conductor mientras el viaje está activo (11.1: viaje en vivo). */
  live: TripDriverLocation.nullable(),
  /** Calificaciones de ambos (el comentario es texto plano: se escapa al mostrarlo). */
  ratings: z.array(AdminTripRating),
});
export type AdminTripDetail = z.infer<typeof AdminTripDetail>;
