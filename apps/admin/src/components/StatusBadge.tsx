import type { DriverStatus } from '@rideapp/contracts';
import { DRIVER_STATUS_LABEL } from '../lib/labels';

export function StatusBadge({ status, submitted }: { status: DriverStatus; submitted?: boolean }) {
  // Pendiente sin enviar = el conductor aún está completando su registro.
  const draft = status === 'PENDING' && submitted === false;
  return (
    <span className={`badge badge--${draft ? 'draft' : status.toLowerCase()}`}>
      {draft ? 'En registro' : DRIVER_STATUS_LABEL[status]}
    </span>
  );
}
