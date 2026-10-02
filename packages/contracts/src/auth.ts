import { z } from 'zod';
import { SelfAssignableRole, UserRole, UserStatus } from './enums.js';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export const Email = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const Password = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

export const FullName = z.string().trim().min(2).max(100);

/** Teléfono en formato E.164 (+57...). */
export const Phone = z.string().regex(/^\+[1-9]\d{7,14}$/);

export const RegisterRequest = z.strictObject({
  email: Email,
  password: Password,
  fullName: FullName,
  role: SelfAssignableRole,
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
export type TokenPair = z.infer<typeof TokenPair>;

export const ForgotPasswordRequest = z.strictObject({ email: Email });
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequest>;

export const ResetPasswordRequest = z.strictObject({
  token: z.string().min(1).max(512),
  password: Password,
});
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequest>;

export const AdminTotpRequest = z.strictObject({
  challengeId: z.string().min(1),
  code: z.string().regex(/^\d{6}$/),
});
export type AdminTotpRequest = z.infer<typeof AdminTotpRequest>;

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
