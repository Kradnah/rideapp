import { ApiClientError, createApiClient } from '@rideapp/api-client';

const CSRF_COOKIE = '__Host-rideapp_admin_csrf';

/**
 * Access token del panel: solo en memoria (nunca en localStorage). Se pierde al recargar y se
 * recupera con la cookie HttpOnly de sesión + el token CSRF (11.1, paso 2).
 */
let accessToken: string | null = null;
let onSessionLost: (() => void) | null = null;

/** La cookie CSRF no es HttpOnly a propósito: el JS la repite en la cabecera (double-submit). */
export function readCsrfCookie(): string | null {
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${CSRF_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(CSRF_COOKIE.length + 1)) : null;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function setOnSessionLost(handler: (() => void) | null): void {
  onSessionLost = handler;
}

let inFlight: Promise<string | null> | null = null;

/**
 * Renueva la sesión con la cookie + CSRF. Un solo refresco a la vez: si se mandaran dos con la
 * misma cookie, el servidor vería un refresh token reutilizado y cerraría la sesión (8.2).
 * Pasa, por ejemplo, con el doble efecto de StrictMode o varias peticiones con 401 a la vez.
 */
export function refreshAdminSession(): Promise<string | null> {
  inFlight ??= doRefresh().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doRefresh(): Promise<string | null> {
  const csrf = readCsrfCookie();
  if (!csrf) {
    onSessionLost?.();
    return null;
  }
  try {
    const session = await api.admin.refresh(csrf);
    accessToken = session.accessToken;
    return session.accessToken;
  } catch (err) {
    if (err instanceof ApiClientError && (err.status === 401 || err.status === 403)) {
      accessToken = null;
      onSessionLost?.();
    }
    return null;
  }
}

/** Mismo origen (`/api`): Traefik o el proxy de Vite lo enrutan al API. */
export const api = createApiClient({
  baseUrl: import.meta.env.VITE_API_URL || '/api',
  credentials: 'include',
  getAccessToken: () => accessToken,
  refreshSession: refreshAdminSession,
});
