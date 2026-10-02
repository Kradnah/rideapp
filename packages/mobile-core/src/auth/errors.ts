import { ApiClientError } from '@rideapp/api-client';

const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'Email o contraseña incorrectos.',
  RATE_LIMITED: 'Demasiados intentos. Espera unos minutos y vuelve a probar.',
  WEAK_PASSWORD:
    'Esa contraseña es muy común o fácil de adivinar. Prueba con una frase de varias palabras.',
  CONFLICT: 'No pudimos crear la cuenta con ese email. Si ya tienes una, inicia sesión.',
  CONSENT_REQUIRED: 'Actualizamos la política de datos. Revísala y acéptala para continuar.',
  ACCOUNT_DISABLED: 'Tu cuenta no está activa. Escríbenos para revisarla.',
  NETWORK_ERROR: 'No hay conexión con el servidor. Revisa tu internet.',
  VALIDATION_FAILED: 'Revisa los datos e inténtalo de nuevo.',
};

/** Mensaje para el usuario a partir de un error del API (nunca detalles técnicos). */
export function friendlyError(err: unknown): string {
  if (err instanceof ApiClientError)
    return MESSAGES[err.code] ?? 'Algo salió mal. Inténtalo de nuevo.';
  return 'Algo salió mal. Inténtalo de nuevo.';
}
