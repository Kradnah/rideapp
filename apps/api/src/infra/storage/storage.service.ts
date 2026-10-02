import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/**
 * Almacenamiento privado de archivos subidos (1, "Archivos"; 14.7). La demo usa disco local
 * cifrado; más adelante un S3 autoalojado (Garage o SeaweedFS) con la misma interfaz.
 */
export abstract class StorageService {
  abstract put(key: string, data: Buffer): Promise<void>;
  abstract get(key: string): Promise<Buffer>;
  abstract delete(key: string): Promise<void>;
}

const MAGIC = Buffer.from('RAS1');
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** Las claves las genera el servidor (`driver-documents/<uuid>`): nada que venga del cliente. */
const SAFE_KEY = /^[a-z0-9-]+\/[0-9a-f-]{36}$/;

/**
 * Disco local con AES-256-GCM por archivo. Formato: `RAS1` + IV (12) + tag (16) + datos cifrados.
 * GCM autentica: un archivo manipulado no se descifra.
 */
export class LocalEncryptedStorage extends StorageService {
  private readonly root: string;

  constructor(
    root: string,
    private readonly key: Buffer,
  ) {
    super();
    if (key.length !== 32) throw new Error('La clave de almacenamiento debe tener 32 bytes');
    this.root = resolve(root);
  }

  private path(key: string): string {
    if (!SAFE_KEY.test(key)) throw new Error('Clave de almacenamiento no válida');
    return join(this.root, `${key}.bin`);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const file = this.path(key);
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, Buffer.concat([MAGIC, iv, cipher.getAuthTag(), encrypted]), {
      mode: 0o600,
      flag: 'wx',
    });
  }

  async get(key: string): Promise<Buffer> {
    const raw = await readFile(this.path(key));
    if (!raw.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Archivo no reconocido');
    const iv = raw.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
    const tag = raw.subarray(MAGIC.length + IV_BYTES, MAGIC.length + IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(raw.subarray(MAGIC.length + IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]);
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}
