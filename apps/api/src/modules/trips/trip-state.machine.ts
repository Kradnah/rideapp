import type { TripEventActor, TripStatus } from '@rideapp/contracts';

/**
 * Máquina de estados del viaje (8.8), en un único lugar: qué transiciones existen y quién puede
 * ejecutar cada una. Cualquier cambio de estado pasa por `canTransition`.
 *
 *   REQUESTED ─► SEARCHING ─► DRIVER_ASSIGNED ─► DRIVER_ARRIVED ─► IN_PROGRESS ─► COMPLETED
 *       │            ├─► NO_DRIVERS   │                 │
 *       └────────────┴────────────────┴─────────────────┴──► CANCELLED
 */
export const TRIP_TRANSITIONS: Readonly<
  Record<TripStatus, Partial<Record<TripStatus, readonly TripEventActor[]>>>
> = {
  REQUESTED: { SEARCHING: ['SYSTEM'], CANCELLED: ['PASSENGER', 'SYSTEM'] },
  SEARCHING: {
    // La asignación la provoca el conductor al aceptar la oferta (8.9, paso 7).
    DRIVER_ASSIGNED: ['DRIVER'],
    NO_DRIVERS: ['SYSTEM'],
    CANCELLED: ['PASSENGER', 'SYSTEM', 'ADMIN'],
  },
  DRIVER_ASSIGNED: {
    DRIVER_ARRIVED: ['DRIVER'],
    CANCELLED: ['PASSENGER', 'DRIVER', 'SYSTEM', 'ADMIN'],
  },
  DRIVER_ARRIVED: {
    IN_PROGRESS: ['DRIVER'],
    CANCELLED: ['PASSENGER', 'DRIVER', 'SYSTEM', 'ADMIN'],
  },
  IN_PROGRESS: { COMPLETED: ['DRIVER'] },
  NO_DRIVERS: {},
  COMPLETED: {},
  CANCELLED: {},
};

export function canTransition(from: TripStatus, to: TripStatus, actor: TripEventActor): boolean {
  return TRIP_TRANSITIONS[from][to]?.includes(actor) ?? false;
}

export function isTerminal(status: TripStatus): boolean {
  return Object.keys(TRIP_TRANSITIONS[status]).length === 0;
}

/** Estados en los que el viaje tiene conductor asignado y lo ocupa. */
export const DRIVER_BUSY_STATUSES = [
  'DRIVER_ASSIGNED',
  'DRIVER_ARRIVED',
  'IN_PROGRESS',
] as const satisfies readonly TripStatus[];
