import { z } from 'zod';
import { SelfAssignableRole, UserRole, UserStatus } from './enums.js';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export const Email = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const Password = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

export const FullName = z.string().trim().min(2).max(100);

/** Teléfono en formato E.164 (+57...). */
export const Phone = z.string().regex(/^\+[1-9]\d{7,14}$/);

/**
 * Versión vigente de la Política de Tratamiento de la Información (Ley 1581, sección 15).
 * Al cambiar la política, se sube esta fecha y el servidor exige volver a aceptar.
 */
export const CURRENT_POLICY_VERSION = '2026-10-01';

/** Autorización previa, expresa e informada: casilla no premarcada + versión que se mostró. */
export const Consent = z.strictObject({
  acceptTerms: z.literal(true),
  policyVersion: z.string().min(1).max(32),
});
export type Consent = z.infer<typeof Consent>;

export const RegisterRequest = z.strictObject({
  email: Email,
  password: Password,
  fullName: FullName,
  role: SelfAssignableRole,
  consent: Consent,
});
export type RegisterRequest = z.infer<typeof RegisterRequest>;

export const LoginRequest = z.strictObject({
  email: Email,
  // En el login no se exige la longitud mínima: un error de formato revelaría la política.
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const GoogleLoginRequest = z.strictObject({
  idToken: z.string().min(1).max(4096),
  role: SelfAssignableRole.optional(),
  /** Obligatorio si es la primera vez (se crea la cuenta); si falta, el API responde CONSENT_REQUIRED. */
  consent: Consent.optional(),
});
export type GoogleLoginRequest = z.infer<typeof GoogleLoginRequest>;

export const RefreshRequest = z.strictObject({
  refreshToken: z.string().min(1).max(512),
});
export type RefreshRequest = z.infer<typeof RefreshRequest>;

export const TokenPair = z.object({
  accessToken: z.string(),
  /** Segundos hasta que caduca el access token. */
  expiresIn: z.number().int().positive(),
  refreshToken: z.string(),
});

/** Contenido del access token (8.2, paso 2). Sin email ni nombre. */
export const AccessTokenClaims = z.object({
  sub: z.uuid(),
  role: UserRole,
  /** Sesión = familia de refresh tokens: revocarla invalida la sesión. */
  sid: z.uuid(),
  /** Métodos de autenticación: el admin necesita ['pwd', 'totp'] (8.14). */
  amr: z.array(z.enum(['pwd', 'google', 'apple', 'totp'])),
  iat: z.number().int(),
  exp: z.number().int(),
});
export type AccessTokenClaims = z.infer<typeof AccessTokenClaims>;
export type TokenPair = z.infer<typeof TokenPair>;

export const ForgotPasswordRequest = z.strictObject({ email: Email });
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequest>;

export const ResetPasswordRequest = z.strictObject({
  token: z.string().min(1).max(512),
  password: Password,
});
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequest>;

/** Paso 1 del login del panel: credenciales correctas → reto para el código TOTP (8.14). */
export const AdminLoginChallenge = z.object({
  challengeId: z.string().min(1),
  /** Segundos que dura el reto. */
  expiresIn: z.number().int().positive(),
});
export type AdminLoginChallenge = z.infer<typeof AdminLoginChallenge>;

export const AdminTotpRequest = z.strictObject({
  challengeId: z.string().min(1).max(128),
  code: z.string().regex(/^\d{6}$/),
});
export type AdminTotpRequest = z.infer<typeof AdminTotpRequest>;

/**
 * Sesión del panel. El refresh token va en una cookie HttpOnly `__Host-` y nunca en el cuerpo;
 * el access token se guarda solo en memoria del navegador (11.1, paso 2).
 */
export const AdminSession = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int().positive(),
});
export type AdminSession = z.infer<typeof AdminSession>;

/** Cabecera que debe repetir el valor de la cookie CSRF en las peticiones con cookie (11.1). */
export const CSRF_HEADER = 'x-csrf-token';

/** Resumen para el dashboard del panel. */
export const AdminOverview = z.object({
  users: z.object({
    passengers: z.number().int().nonnegative(),
    drivers: z.number().int().nonnegative(),
    admins: z.number().int().nonnegative(),
  }),
});
export type AdminOverview = z.infer<typeof AdminOverview>;

/** Perfil propio (GET /me). */
export const Me = z.object({
  id: z.uuid(),
  email: z.string().nullable(),
  emailVerified: z.boolean(),
  fullName: z.string(),
  phone: z.string().nullable(),
  role: UserRole,
  status: UserStatus,
  createdAt: z.iso.datetime(),
});
export type Me = z.infer<typeof Me>;

export const UpdateMeRequest = z.strictObject({
  fullName: FullName.optional(),
  phone: Phone.nullable().optional(),
});
export type UpdateMeRequest = z.infer<typeof UpdateMeRequest>;
