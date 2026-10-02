import { Injectable, Logger } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { InjectEnv } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';

/** Datos que se usan del idToken verificado. Nunca se confía en lo que la app envíe aparte (8.2). */
export interface GoogleIdentity {
  /** ID estable de la cuenta de Google: el usuario se identifica por esto, no por el email. */
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  /** Caducidad del token (segundos epoch), para la protección anti-replay. */
  exp: number;
}

export interface GoogleTokenVerifier {
  readonly enabled: boolean;
  /** null si el token no es válido (firma, caducidad, emisor o audience incorrectos). */
  verify(idToken: string): Promise<GoogleIdentity | null>;
}

export const GOOGLE_VERIFIER = Symbol('GOOGLE_VERIFIER');

const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

/**
 * Verifica idTokens con google-auth-library: firma con las claves públicas de Google
 * (cacheadas por la librería), `exp`, `iss` y `aud` = Client ID web (8.2, flujo, paso 1).
 */
@Injectable()
export class GoogleAuthLibraryVerifier implements GoogleTokenVerifier {
  private readonly logger = new Logger(GoogleAuthLibraryVerifier.name);
  private readonly client = new OAuth2Client();
  private readonly audience: string | undefined;

  constructor(@InjectEnv() env: Env) {
    this.audience = env.GOOGLE_WEB_CLIENT_ID;
  }

  get enabled(): boolean {
    return Boolean(this.audience);
  }

  async verify(idToken: string): Promise<GoogleIdentity | null> {
    if (!this.audience) return null;
    try {
      const ticket = await this.client.verifyIdToken({ idToken, audience: this.audience });
      const p = ticket.getPayload();
      if (!p?.sub || !p.email || !p.exp || !p.iss || !ISSUERS.has(p.iss)) return null;
      return {
        sub: p.sub,
        email: p.email.toLowerCase(),
        emailVerified: p.email_verified === true,
        name: p.name?.trim() || null,
        exp: p.exp,
      };
    } catch (err) {
      this.logger.debug({ err: (err as Error).message }, 'idToken de Google rechazado');
      return null;
    }
  }
}
