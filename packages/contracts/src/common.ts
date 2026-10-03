import { z } from 'zod';

export const Uuid = z.uuid();

export const LatLng = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type LatLng = z.infer<typeof LatLng>;

/** Código de moneda ISO 4217 (tres letras mayúsculas). */
export const CurrencyCode = z.string().regex(/^[A-Z]{3}$/);

/**
 * Dinero siempre como entero en la unidad mínima ISO 4217 (para COP, centavos).
 * Nunca float (7.2).
 */
export const Money = z.object({
  amountCents: z.number().int().nonnegative(),
  currency: CurrencyCode,
});
export type Money = z.infer<typeof Money>;

export const DEFAULT_CURRENCY = 'COP';

export const PaginationQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof PaginationQuery>;

export const Paginated = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
export type Paginated<T> = { items: T[]; nextCursor: string | null };

export const ErrorCode = z.enum([
  'VALIDATION_FAILED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'UPGRADE_REQUIRED',
  'OUT_OF_SERVICE_AREA',
  'INVALID_CREDENTIALS',
  'WEAK_PASSWORD',
  'CONSENT_REQUIRED',
  'ACCOUNT_DISABLED',
  'INVALID_CODE',
  'SERVICE_UNAVAILABLE',
  'QUOTE_EXPIRED',
  'ACTIVE_TRIP_EXISTS',
  'INVALID_PIN',
  'NOT_AT_PICKUP',
  'DRIVER_NOT_APPROVED',
  'REQUIREMENTS_INCOMPLETE',
  'UNSUPPORTED_FILE',
  'FILE_TOO_LARGE',
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** Forma única de todos los errores del API (7.5, paso 7). */
export const ApiError = z.object({
  code: ErrorCode,
  message: z.string(),
  details: z.unknown().optional(),
  requestId: z.string().optional(),
});
export type ApiError = z.infer<typeof ApiError>;

/** Respuesta de `/health/live` y `/health/ready`. */
export const HealthResponse = z.object({
  status: z.enum(['ok', 'error']),
  checks: z.record(z.string(), z.enum(['up', 'down'])).optional(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

/**
 * Versión de la app móvil (14.5): la envían las apps en cada petición; si es menor que la mínima
 * configurada en el servidor, el API responde `426 UPGRADE_REQUIRED`.
 */
export const APP_VERSION_HEADER = 'x-app-version';
export const AppVersion = z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/);

/** Compara versiones `x.y.z`: negativo si a < b, 0 si son iguales, positivo si a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
