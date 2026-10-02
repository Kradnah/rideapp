import { existsSync } from 'node:fs';
import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const commaList = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.url()));

/**
 * Variables de entorno del API. Se validan al arrancar (7.5, paso 2):
 * si falta algo obligatorio, la app no arranca.
 */
export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: z.string().default('127.0.0.1'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    /** true detrás de Traefik, para que la IP del cliente (rate limiting, auditoría) sea la real. */
    TRUST_PROXY: booleanString.default(false),

    DATABASE_URL: z
      .url()
      .refine((u) => /^postgres(ql)?:\/\//.test(u), 'Debe ser una URL de Postgres'),
    REDIS_URL: z.url().refine((u) => /^rediss?:\/\//.test(u), 'Debe ser una URL de Redis'),

    CORS_ORIGINS: commaList,

    MAPS_PROVIDER: z.enum(['fake', 'google']).default('fake'),
    GOOGLE_MAPS_SERVER_KEY: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.MAPS_PROVIDER === 'google' && !env.GOOGLE_MAPS_SERVER_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_MAPS_SERVER_KEY'],
        message: 'Obligatoria con MAPS_PROVIDER=google',
      });
    }
    if (env.NODE_ENV === 'production' && env.CORS_ORIGINS.some((o) => !o.startsWith('https://'))) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'En producción solo se permiten orígenes https://',
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export class InvalidEnvError extends Error {
  constructor(readonly issues: string[]) {
    super(`Configuración inválida:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
  }
}

/** Valida un objeto de entorno. Los mensajes nunca incluyen los valores (pueden ser secretos). */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    throw new InvalidEnvError(
      result.error.issues.map((i) => `${i.path.join('.') || '(raíz)'}: ${i.message}`),
    );
  }
  return result.data;
}

/** Carga apps/api/.env en desarrollo (si existe) y valida `process.env`. */
export function loadEnv(): Env {
  if (process.env['NODE_ENV'] !== 'production' && existsSync('.env')) {
    process.loadEnvFile('.env');
  }
  return parseEnv(process.env);
}
