import type { DriverStatus, TripStatus, UserStatus } from '@rideapp/contracts';
import { DRIVER_STATUS_LABEL, TRIP_STATUS_LABEL, USER_STATUS_LABEL } from '../lib/labels';

export function StatusBadge({ status, submitted }: { status: DriverStatus; submitted?: boolean }) {
  // Pendiente sin enviar = el conductor aún está completando su registro.
  const draft = status === 'PENDING' && submitted === false;
  return (
    <span className={`badge badge--${draft ? 'draft' : status.toLowerCase()}`}>
      {draft ? 'En registro' : DRIVER_STATUS_LABEL[status]}
    </span>
  );
}

/** En curso → ámbar; completado → verde; cancelado o sin conductores → rojo. */
export function TripStatusBadge({ status }: { status: TripStatus }) {
  const tone =
    status === 'COMPLETED'
      ? 'approved'
      : status === 'CANCELLED' || status === 'NO_DRIVERS'
        ? 'rejected'
        : 'pending';
  return <span className={`badge badge--${tone}`}>{TRIP_STATUS_LABEL[status]}</span>;
}

export function UserStatusBadge({ status }: { status: UserStatus }) {
  const tone = status === 'ACTIVE' ? 'approved' : 'suspended';
  return <span className={`badge badge--${tone}`}>{USER_STATUS_LABEL[status]}</span>;
}
