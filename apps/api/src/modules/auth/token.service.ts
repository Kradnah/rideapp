import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { type AccessTokenClaims, AccessTokenClaims as ClaimsSchema } from '@rideapp/contracts';
import { decodeProtectedHeader, jwtVerify, SignJWT } from 'jose';
import { InjectEnv } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';

const ISSUER = 'rideapp-api';
const AUDIENCE = 'rideapp';
const ALG = 'ES256';

export type AccessTokenInput = Pick<AccessTokenClaims, 'sub' | 'role' | 'sid' | 'amr'>;

/**
 * Access tokens JWT firmados con ES256 (8.2, paso 2). La clave privada solo vive en el servidor;
 * `kid` en la cabecera permite rotarla: para rotar, se añade la nueva y se conserva la pública
 * anterior hasta que caduquen sus tokens (15 min).
 */
@Injectable()
export class TokenService {
  private readonly privateKey: KeyObject;
  private readonly publicKeys: Map<string, KeyObject>;
  private readonly kid: string;
  readonly accessTtlSeconds: number;

  constructor(@InjectEnv() env: Env) {
    this.privateKey = createPrivateKey(env.JWT_PRIVATE_KEY);
    this.kid = env.JWT_KID;
    this.publicKeys = new Map([[env.JWT_KID, createPublicKey(this.privateKey)]]);
    this.accessTtlSeconds = env.ACCESS_TOKEN_TTL_SECONDS;
  }

  async signAccessToken(input: AccessTokenInput): Promise<string> {
    return new SignJWT({ role: input.role, sid: input.sid, amr: input.amr })
      .setProtectedHeader({ alg: ALG, kid: this.kid, typ: 'JWT' })
      .setSubject(input.sub)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.accessTtlSeconds}s`)
      .sign(this.privateKey);
  }

  /** Devuelve los claims si el token es válido; null en cualquier otro caso (sin detallar por qué). */
  async verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
    try {
      const { kid } = decodeProtectedHeader(token);
      const key = kid ? this.publicKeys.get(kid) : undefined;
      if (!key) return null;
      const { payload } = await jwtVerify(token, key, {
        algorithms: [ALG],
        issuer: ISSUER,
        audience: AUDIENCE,
      });
      const parsed = ClaimsSchema.safeParse(payload);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }
}
