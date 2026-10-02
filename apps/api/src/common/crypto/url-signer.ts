import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * URLs firmadas de corta duración (8.14, paso 3; 14.7): HMAC-SHA256 de `recurso.caducidad`.
 * Quien tenga la URL puede abrir el archivo hasta que caduque, por eso duran pocos minutos y
 * el log de peticiones nunca guarda la query string (logger.options.ts).
 */
export class UrlSigner {
  constructor(private readonly key: Buffer) {}

  sign(resource: string, expiresAtMs: number): string {
    return createHmac('sha256', this.key).update(`${resource}.${expiresAtMs}`).digest('base64url');
  }

  verify(resource: string, expiresAtMs: number, signature: string, now = Date.now()): boolean {
    if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs < now) return false;
    const expected = Buffer.from(this.sign(resource, expiresAtMs));
    const given = Buffer.from(signature);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }
}
