import { z } from 'zod';

export const UserRole = z.enum(['PASSENGER', 'DRIVER', 'ADMIN']);
export type UserRole = z.infer<typeof UserRole>;

/** Roles que un usuario puede elegir al registrarse. ADMIN solo se crea por CLI (8.14). */
export const SelfAssignableRole = UserRole.extract(['PASSENGER', 'DRIVER']);
export type SelfAssignableRole = z.infer<typeof SelfAssignableRole>;

export const UserStatus = z.enum(['ACTIVE', 'SUSPENDED', 'DELETED']);
export type UserStatus = z.infer<typeof UserStatus>;

/** Máquina de estados del viaje (8.8). Las transiciones válidas viven en el backend. */
export const TripStatus = z.enum([
  'REQUESTED',
  'SEARCHING',
  'NO_DRIVERS',
  'DRIVER_ASSIGNED',
  'DRIVER_ARRIVED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
]);
export type TripStatus = z.infer<typeof TripStatus>;

export const ACTIVE_TRIP_STATUSES = [
  'REQUESTED',
  'SEARCHING',
  'DRIVER_ASSIGNED',
  'DRIVER_ARRIVED',
  'IN_PROGRESS',
] as const satisfies readonly TripStatus[];

export const CancelledBy = z.enum(['PASSENGER', 'DRIVER', 'SYSTEM']);
export type CancelledBy = z.infer<typeof CancelledBy>;

/** Estado administrativo del perfil de conductor (8.4). */
export const DriverStatus = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED']);
export type DriverStatus = z.infer<typeof DriverStatus>;

/** Disponibilidad operativa en tiempo real (vive en Redis). */
export const DriverAvailability = z.enum(['OFFLINE', 'AVAILABLE', 'BUSY']);
export type DriverAvailability = z.infer<typeof DriverAvailability>;

export const VehicleCategory = z.enum(['STANDARD', 'MOTO']);
export type VehicleCategory = z.infer<typeof VehicleCategory>;

export const PaymentMethod = z.enum(['CASH', 'FAKE_CARD']);
export type PaymentMethod = z.infer<typeof PaymentMethod>;

export const PaymentStatus = z.enum(['PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED']);
export type PaymentStatus = z.infer<typeof PaymentStatus>;
