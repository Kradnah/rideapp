import { Secret, TOTP } from 'otpauth';
import type { FieldCrypto } from '../../common/crypto/field-crypto.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { PasswordService } from '../auth/password.service.js';

export const TOTP_ISSUER = 'rideapp';
const TOTP_PERIOD = 30;

export function buildTotp(secretBase32: string, label: string): TOTP {
  return new TOTP({
    issuer: TOTP_ISSUER,
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: TOTP_PERIOD,
    secret: Secret.fromBase32(secretBase32),
  });
}

/**
 * Valida un código TOTP con tolerancia de ±1 intervalo (30 s) y devuelve el intervalo usado,
 * para que el llamante rechace códigos ya utilizados. null si no es válido.
 */
export function validateTotp(totp: TOTP, code: string, now = Date.now()): bigint | null {
  const delta = totp.validate({ token: code, window: 1, timestamp: now });
  if (delta === null) return null;
  return BigInt(Math.floor(now / 1000 / TOTP_PERIOD) + delta);
}

export interface CreateAdminInput {
  email: string;
  fullName: string;
  password: string;
}

export interface CreatedAdmin {
  userId: string;
  /** URI otpauth:// para el QR de Google Authenticator o Aegis. Se muestra una sola vez. */
  otpauthUri: string;
  secretBase32: string;
}

/**
 * Alta de un administrador (8.14, paso 7): los admins no se registran por el API.
 * Lo usa la CLI `create-admin` y los tests.
 */
export async function createAdmin(
  deps: { prisma: PrismaClient; crypto: FieldCrypto; passwords: PasswordService },
  input: CreateAdminInput,
): Promise<CreatedAdmin> {
  const email = input.email.trim().toLowerCase();
  const problem = deps.passwords.check(input.password, email);
  if (input.password.length < 12 || problem) {
    throw new Error('Contraseña demasiado débil: usa al menos 12 caracteres y que no sea común');
  }
  if (await deps.prisma.user.findFirst({ where: { email } })) {
    throw new Error(`Ya existe un usuario con el email ${email}`);
  }

  const secret = new Secret({ size: 20 });
  const user = await deps.prisma.user.create({
    data: {
      email,
      emailVerified: true,
      fullName: input.fullName,
      role: 'ADMIN',
      passwordHash: await deps.passwords.hash(input.password),
      adminTotp: { create: { secretEnc: deps.crypto.encrypt(secret.base32) } },
    },
  });
  await deps.prisma.auditLog.create({
    data: {
      actorId: null,
      action: 'admin.created',
      entity: 'user',
      entityId: user.id,
      meta: { via: 'cli' },
    },
  });

  return {
    userId: user.id,
    otpauthUri: buildTotp(secret.base32, email).toString(),
    secretBase32: secret.base32,
  };
}
