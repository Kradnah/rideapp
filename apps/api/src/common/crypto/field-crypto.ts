import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const IV_BYTES = 12;

/**
 * Cifrado de columnas con AES-256-GCM (8.4, paso 5). Formato: `v1.<iv>.<tag>.<cifrado>` en base64url.
 * GCM autentica: un valor manipulado no se descifra, lanza error.
 * Es una clase sin dependencias de Nest para poder usarla también desde la CLI.
 */
export class FieldCrypto {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32) throw new Error('FIELD_ENCRYPTION_KEY debe tener 32 bytes');
  }

  encrypt(plain: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [VERSION, iv, cipher.getAuthTag(), data]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
      .join('.');
  }

  decrypt(payload: string): string {
    const [version, iv, tag, data] = payload.split('.');
    if (version !== VERSION || !iv || !tag || !data)
      throw new Error('Formato de cifrado desconocido');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
