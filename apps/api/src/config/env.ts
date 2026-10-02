import { createPrivateKey } from 'node:crypto';
import { existsSync } from 'node:fs';
import { z } from 'zod';

/**
 * Clave PEM en la variable de entorno: admite el PEM tal cual, con saltos de línea escapados
 * (`\n` literal) o codificado en base64 (más cómodo en paneles como Dokploy).
 */
const pemKey = z
  .string()
  .min(1)
  .transform((v) => {
    const raw = v.trim();
    if (raw.startsWith('-----BEGIN')) return raw.replace(/\\n/g, '\n');
    return Buffer.from(raw, 'base64').toString('utf8');
  })
  .refine((pem) => {
    try {
      const key = createPrivateKey(pem);
      return (
        key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1'
      );
    } catch {
      return false;
    }
  }, 'Debe ser una clave privada EC P-256 (ES256) en PEM o base64');

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

    /** Clave privada ES256 de los access tokens; la pública se deriva de ella (8.2, paso 2). */
    JWT_PRIVATE_KEY: pemKey,
    /** Identificador de la clave (cabecera `kid`), para poder rotarla. */
    JWT_KID: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
    /** 10–15 minutos como máximo (8.2). */
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),

    /** Clave AES-256-GCM (32 bytes en base64) para cifrar columnas sensibles: secretos TOTP, licencias (8.4). */
    FIELD_ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'Deben ser 32 bytes en base64'),

    /** Client ID "Aplicación web" de Google: audience del idToken (8.2). Sin él, /auth/google responde 404. */
    GOOGLE_WEB_CLIENT_ID: z
      .string()
      .regex(/^[\w-]+\.apps\.googleusercontent\.com$/, 'Client ID de Google no válido')
      .optional(),

    /**
     * Correo saliente (verificación de email, recuperación de contraseña).
     * smtp: envía de verdad · log: lo escribe en el log (solo desarrollo) · disabled: no envía.
     */
    MAIL_TRANSPORT: z.enum(['smtp', 'log', 'disabled']).default('disabled'),
    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    /** true para TLS implícito (puerto 465); false para STARTTLS (587). */
    SMTP_SECURE: booleanString.default(false),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
    /** Remitente, p. ej. "rideapp <no-reply@tudominio.com>". */
    MAIL_FROM: z.string().min(3).optional(),

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
    if (env.MAIL_TRANSPORT === 'smtp' && (!env.SMTP_HOST || !env.MAIL_FROM)) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_HOST'],
        message: 'MAIL_TRANSPORT=smtp necesita SMTP_HOST y MAIL_FROM',
      });
    }
    if (env.NODE_ENV === 'production' && env.MAIL_TRANSPORT === 'log') {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_TRANSPORT'],
        message:
          'En producción no se permite MAIL_TRANSPORT=log (los códigos acabarían en los logs)',
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
