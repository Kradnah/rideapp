import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { deriveKey } from '../src/common/crypto/derived-keys.js';
import { UrlSigner } from '../src/common/crypto/url-signer.js';
import { LocalEncryptedStorage } from '../src/infra/storage/storage.service.js';

const MASTER = Buffer.alloc(32, 7).toString('base64');
const dir = mkdtempSync(join(tmpdir(), 'rideapp-storage-unit-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('claves derivadas', () => {
  it('una clave distinta por uso, estable entre arranques', () => {
    const storage = deriveKey(MASTER, 'storage:v1');
    expect(storage).toHaveLength(32);
    expect(storage.equals(deriveKey(MASTER, 'storage:v1'))).toBe(true);
    expect(storage.equals(deriveKey(MASTER, 'signed-url:v1'))).toBe(false);
    expect(storage.equals(Buffer.from(MASTER, 'base64'))).toBe(false);
  });
});

describe('LocalEncryptedStorage', () => {
  const storage = new LocalEncryptedStorage(dir, deriveKey(MASTER, 'storage:v1'));

  it('guarda cifrado y recupera el contenido original', async () => {
    const key = `driver-documents/${randomUUID()}`;
    const data = Buffer.from('%PDF-1.4 contenido sensible');
    await storage.put(key, data);
    const raw = readFileSync(join(dir, `${key}.bin`));
    expect(raw.includes(Buffer.from('sensible'))).toBe(false);
    expect((await storage.get(key)).equals(data)).toBe(true);
    // Nunca sobrescribe un archivo existente.
    await expect(storage.put(key, data)).rejects.toThrow();
  });

  it('un archivo manipulado no se descifra', async () => {
    const key = `driver-documents/${randomUUID()}`;
    await storage.put(key, Buffer.from('original'));
    const file = join(dir, `${key}.bin`);
    const raw = readFileSync(file);
    raw.writeUInt8(raw.readUInt8(raw.length - 1) ^ 0xff, raw.length - 1);
    writeFileSync(file, raw);
    await expect(storage.get(key)).rejects.toThrow();
  });

  it('con otra clave tampoco', async () => {
    const key = `driver-documents/${randomUUID()}`;
    await storage.put(key, Buffer.from('original'));
    const other = new LocalEncryptedStorage(dir, deriveKey(MASTER, 'signed-url:v1'));
    await expect(other.get(key)).rejects.toThrow();
  });

  it('rechaza claves que podrían salirse de la carpeta', async () => {
    for (const key of ['../etc/passwd', 'driver-documents/../../x', 'driver-documents/abc']) {
      await expect(storage.put(key, Buffer.from('x'))).rejects.toThrow('no válida');
    }
  });
});

describe('UrlSigner', () => {
  const signer = new UrlSigner(deriveKey(MASTER, 'signed-url:v1'));
  const now = 1_800_000_000_000;

  it('acepta la firma correcta antes de caducar', () => {
    const sig = signer.sign('doc:1', now + 60_000);
    expect(signer.verify('doc:1', now + 60_000, sig, now)).toBe(true);
  });

  it('rechaza otro recurso, otra caducidad, firma alterada o caducada', () => {
    const sig = signer.sign('doc:1', now + 60_000);
    expect(signer.verify('doc:2', now + 60_000, sig, now)).toBe(false);
    expect(signer.verify('doc:1', now + 120_000, sig, now)).toBe(false);
    expect(signer.verify('doc:1', now + 60_000, `${sig.slice(0, -1)}A`, now)).toBe(false);
    expect(signer.verify('doc:1', now + 60_000, sig, now + 60_001)).toBe(false);
    expect(signer.verify('doc:1', now + 60_000, 'corta', now)).toBe(false);
  });
});
