import { ApiClientError } from '@rideapp/api-client';
import type {
  DriverAvailability,
  DriverDocumentType,
  DriverStatus,
  Money,
  PaymentMethod,
  PaymentStatus,
  TripEventActor,
  TripStatus,
  UserRole,
  UserStatus,
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

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  PENDING: 'Pendiente',
  AUTHORIZED: 'Autorizado',
  CAPTURED: 'Cobrado',
  FAILED: 'Fallido',
  REFUNDED: 'Reembolsado',
};

export const ROLE_LABEL: Record<UserRole, string> = {
  PASSENGER: 'Pasajero',
  DRIVER: 'Conductor',
  ADMIN: 'Administrador',
};

export const USER_STATUS_LABEL: Record<UserStatus, string> = {
  ACTIVE: 'Activo',
  SUSPENDED: 'Suspendido',
  DELETED: 'Eliminado',
};

/** Acciones de auditoría conocidas; las demás se muestran con su código. */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  'auth.register': 'Registro',
  'auth.login': 'Inicio de sesión',
  'auth.login_failed': 'Inicio de sesión fallido',
  'auth.logout': 'Cierre de sesión',
  'auth.logout_all': 'Cerró todas las sesiones',
  'auth.google_linked': 'Google vinculado',
  'auth.email_verified': 'Email verificado',
  'auth.password_reset_requested': 'Pidió restablecer la contraseña',
  'auth.password_reset': 'Contraseña restablecida',
  'auth.refresh_reuse_detected': 'Reutilización de sesión detectada',
  'admin.created': 'Admin creado (CLI)',
  'admin.login': 'Admin: inicio de sesión',
  'admin.login_failed': 'Admin: inicio de sesión fallido',
  'admin.logout': 'Admin: cierre de sesión',
  'admin.driver_approved': 'Conductor aprobado',
  'admin.driver_rejected': 'Conductor rechazado',
  'admin.driver_suspended': 'Conductor suspendido',
  'admin.driver_reactivated': 'Conductor reactivado',
  'admin.driver_document_viewed': 'Documento consultado',
  'admin.driver_field_revealed': 'Dato del conductor revelado',
  'admin.user_field_revealed': 'Teléfono revelado',
  'admin.user_suspended': 'Usuario suspendido',
  'admin.user_reactivated': 'Usuario reactivado',
  'admin.fare_rule_created': 'Tarifa creada',
  'payment.created': 'Pago creado',
  'payment.cash_confirmed': 'Cobro en efectivo confirmado',
};

/** Promedio con un decimal: "4,8". */
export function formatRating(average: number | null): string {
  return average === null ? '—' : `★ ${average.toFixed(1).replace('.', ',')}`;
}

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
