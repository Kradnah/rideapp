import { createApiClient } from '@rideapp/api-client';

/**
 * Cliente del API para el panel. Mismo origen (`/api`) y cookies: la sesión del admin
 * irá en una cookie `__Host-` HttpOnly (11.1, paso 2), nunca en localStorage.
 */
export const api = createApiClient({
  baseUrl: import.meta.env.VITE_API_URL || '/api',
  credentials: 'include',
});
