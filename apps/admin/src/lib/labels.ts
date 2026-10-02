import { ApiClientError } from '@rideapp/api-client';
import type {
  DriverAvailability,
  DriverDocumentType,
  DriverStatus,
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
