import { generateKeyPairSync } from 'node:crypto';
import { type Env, parseEnv } from '../../src/config/env.js';

/** Clave ES256 de usar y tirar para los tests. */
export function testJwtKey(): string {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64');
}

export const TEST_JWT_KEY = testJwtKey();

export function testEnv(overrides: Record<string, string> = {}): Env {
  return parseEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/x',
    REDIS_URL: 'redis://127.0.0.1:1',
    CORS_ORIGINS: 'http://localhost:5173',
    JWT_PRIVATE_KEY: TEST_JWT_KEY,
    JWT_KID: 'test-1',
    ...overrides,
  });
}
