import { hash, verify } from '@node-rs/argon2';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { COMMON_PASSWORDS_10_PLUS } from './common-passwords.data.js';

/** Parámetros mínimos de OWASP para Argon2id: 19 MiB, 2 iteraciones, 1 hilo (8.2, paso 1). */
// `Algorithm` es un const enum (incompatible con isolatedModules): 2 = Argon2id.
const ARGON2ID = 2;
const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export type PasswordProblem = 'COMMON' | 'CONTAINS_EMAIL' | 'REPETITIVE';

@Injectable()
export class PasswordService implements OnModuleInit {
  private readonly common = new Set(COMMON_PASSWORDS_10_PLUS.split('\n'));
  /** Hash de una contraseña aleatoria: se verifica contra él cuando el email no existe (8.2, paso 4). */
  private dummyHash = '';

  async onModuleInit(): Promise<void> {
    this.dummyHash = await hash(crypto.randomUUID(), ARGON2_OPTIONS);
  }

  hash(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  /**
   * Verifica en tiempo similar exista o no la cuenta, para no revelar qué emails están
   * registrados midiendo el tiempo de respuesta.
   */
  async verify(passwordHash: string | null | undefined, password: string): Promise<boolean> {
    try {
      const ok = await verify(passwordHash || this.dummyHash, password);
      return ok && Boolean(passwordHash);
    } catch {
      return false;
    }
  }

  /** Reglas además de la longitud (que valida el contrato). Devuelve null si es aceptable. */
  check(password: string, email: string): PasswordProblem | null {
    const lower = password.toLowerCase();
    if (this.common.has(lower)) return 'COMMON';
    const local = email.split('@')[0]?.toLowerCase() ?? '';
    if (local.length >= 4 && lower.includes(local)) return 'CONTAINS_EMAIL';
    if (new Set(lower).size <= 2) return 'REPETITIVE';
    return null;
  }
}
