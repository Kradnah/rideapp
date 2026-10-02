import { ApiClientError } from '@rideapp/api-client';
import type {
  DriverAvailability,
  DriverDocumentType,
  DriverStatus,
  Money,
  PaymentMethod,
  TripEventActor,
  TripStatus,
  VehicleCategory,
} from '@rideapp/contracts';

export const DRIVER_STATUS_LABEL: Record<DriverStatus, string> = {
  PENDING: 'Pendiente',
  APPROVED: 'Aprobado',
  REJECTED: 'Rechazado',
  SUSPENDED: 'Suspendido',
};

export const DOCUMENT_LABEL: Record<DriverDocumentType, string> = {
  DRIVER_LICENSE: 'Licencia de conducción',
  VEHICLE_REGISTRATION: 'Tarjeta de propiedad',
  SOAT: 'SOAT',
};

export const CATEGORY_LABEL: Record<VehicleCategory, string> = {
  STANDARD: 'Carro',
  MOTO: 'Moto',
};

export const AVAILABILITY_LABEL: Record<DriverAvailability, string> = {
  OFFLINE: 'Fuera de línea',
  AVAILABLE: 'En línea',
  BUSY: 'En viaje',
};

export const TRIP_STATUS_LABEL: Record<TripStatus, string> = {
  REQUESTED: 'Solicitado',
  SEARCHING: 'Buscando conductor',
  NO_DRIVERS: 'Sin conductores',
  DRIVER_ASSIGNED: 'Conductor en camino',
  DRIVER_ARRIVED: 'Conductor en el punto',
  IN_PROGRESS: 'En viaje',
  COMPLETED: 'Completado',
  CANCELLED: 'Cancelado',
};

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Efectivo',
  FAKE_CARD: 'Tarjeta (demo)',
};

export const ACTOR_LABEL: Record<TripEventActor, string> = {
  PASSENGER: 'Pasajero',
  DRIVER: 'Conductor',
  SYSTEM: 'Sistema',
  ADMIN: 'Administrador',
};

const cop = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

/** Importes en centavos (8.7) → "$ 12.300". */
export function formatMoney({ amountCents, currency }: Money): string {
  if (currency !== 'COP') return `${(amountCents / 100).toFixed(2)} ${currency}`;
  return cop.format(amountCents / 100);
}

export function formatDistance(meters: number): string {
  return meters < 1000 ? `${meters} m` : `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
}

export function formatDuration(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

const dateTime = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' });

export function formatDate(iso: string | null): string {
  return iso ? dateTime.format(new Date(iso)) : '—';
}

export function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Mensaje para el admin: el del servidor si es un error del contrato, uno genérico si no. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) {
    return err.code === 'NETWORK_ERROR' ? 'No hay conexión con el servidor.' : err.message;
  }
  return 'Algo salió mal. Inténtalo de nuevo.';
}
