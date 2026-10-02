import { ApiClientError } from '@rideapp/api-client';
import { friendlyError, useSession } from '@rideapp/mobile-core';
import { useQuery } from '@tanstack/react-query';

export const DRIVER_ACCOUNT_KEY = ['driver', 'me'] as const;

/**
 * Estado de la cuenta de conductor (GET /drivers/me). Mientras espera la revisión se consulta
 * cada 30 s para enterarse de la aprobación (10.1, paso 2; el push llega en la Fase 5).
 */
export function useDriverAccount() {
  const { api } = useSession();
  return useQuery({
    queryKey: DRIVER_ACCOUNT_KEY,
    queryFn: () => api.drivers.me(),
    refetchInterval: (q) =>
      q.state.data?.status === 'PENDING' && q.state.data.submitted ? 30_000 : false,
  });
}

/** Los mensajes de las rutas de conductor ya vienen en español para el usuario. */
export function driverError(err: unknown): string {
  if (err instanceof ApiClientError && err.code !== 'NETWORK_ERROR' && err.status < 500) {
    if (err.code === 'VALIDATION_FAILED') return 'Revisa los datos e inténtalo de nuevo.';
    return err.message;
  }
  return friendlyError(err);
}
