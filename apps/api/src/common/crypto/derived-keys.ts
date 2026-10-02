import { hkdfSync } from 'node:crypto';

/**
 * Subclaves derivadas de FIELD_ENCRYPTION_KEY con HKDF-SHA256, una por uso (separación de dominio):
 * así cifrar archivos o firmar URLs no reutiliza la clave de las columnas, y no hace falta
 * otro secreto en el entorno.
 */
export type KeyPurpose = 'storage:v1' | 'signed-url:v1';

export function deriveKey(base64MasterKey: string, purpose: KeyPurpose): Buffer {
  const master = Buffer.from(base64MasterKey, 'base64');
  return Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), `rideapp:${purpose}`, 32));
}
