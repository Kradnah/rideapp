import { describe, expect, it } from 'vitest';
import { InvalidEnvError, parseEnv } from '../src/config/env.js';

const base = {
  DATABASE_URL: 'postgresql://rideapp:secreto@127.0.0.1:5432/rideapp',
  REDIS_URL: 'redis://:secreto@127.0.0.1:6379',
};

describe('parseEnv', () => {
  it('aplica valores por defecto seguros', () => {
    const env = parseEnv(base);
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      HOST: '127.0.0.1',
      MAPS_PROVIDER: 'fake',
      TRUST_PROXY: false,
      CORS_ORIGINS: [],
    });
  });

  it('no arranca si falta un secreto, y el mensaje no incluye valores', () => {
    try {
      parseEnv({ REDIS_URL: 'redis://:super-secreto@127.0.0.1:6379' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidEnvError);
      expect((err as Error).message).toContain('DATABASE_URL');
      expect((err as Error).message).not.toContain('super-secreto');
    }
  });

  it('exige la clave de Google con MAPS_PROVIDER=google', () => {
    expect(() => parseEnv({ ...base, MAPS_PROVIDER: 'google' })).toThrow(/GOOGLE_MAPS_SERVER_KEY/);
  });

  it('parsea la lista de orígenes CORS', () => {
    const env = parseEnv({ ...base, CORS_ORIGINS: 'http://localhost:5173, https://a.example.com' });
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173', 'https://a.example.com']);
  });

  it('en producción rechaza orígenes sin https', () => {
    expect(() =>
      parseEnv({ ...base, NODE_ENV: 'production', CORS_ORIGINS: 'http://inseguro.example.com' }),
    ).toThrow(/CORS_ORIGINS/);
  });

  it('rechaza URLs de BD que no son de Postgres', () => {
    expect(() => parseEnv({ ...base, DATABASE_URL: 'mysql://x@y/z' })).toThrow(/DATABASE_URL/);
  });
});
