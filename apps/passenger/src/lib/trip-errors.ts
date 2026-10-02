import { ApiClientError } from '@rideapp/api-client';
import { friendlyError } from '@rideapp/mobile-core';

/** Las rutas de viajes y mapas ya responden en español para el usuario. */
export function tripError(err: unknown): string {
  if (err instanceof ApiClientError && err.code !== 'NETWORK_ERROR' && err.status < 500) {
    if (err.code === 'VALIDATION_FAILED' && err.status === 400) {
      return 'Revisa los datos e inténtalo de nuevo.';
    }
    return err.message;
  }
  if (err instanceof ApiClientError && err.code === 'SERVICE_UNAVAILABLE') return err.message;
  return friendlyError(err);
}

export const isApiError = (err: unknown, code: string): boolean =>
  err instanceof ApiClientError && err.code === code;
