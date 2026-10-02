import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { TokenService } from '../src/modules/auth/token.service.js';
import { testEnv, testJwtKey } from './helpers/test-env.js';

const claims = () => ({
  sub: randomUUID(),
  role: 'PASSENGER' as const,
  sid: randomUUID(),
  amr: ['pwd' as const],
});

describe('TokenService', () => {
  const tokens = new TokenService(testEnv());

  it('firma y verifica un access token con los claims del contrato', async () => {
    const input = claims();
    const token = await tokens.signAccessToken(input);
    const verified = await tokens.verifyAccessToken(token);
    expect(verified).toMatchObject(input);
    expect(verified!.exp - verified!.iat).toBe(900);
  });

  it('no incluye email ni nombre en el token', async () => {
    const token = await tokens.signAccessToken(claims());
    const payload = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString());
    expect(Object.keys(payload).sort()).toEqual([
      'amr',
      'aud',
      'exp',
      'iat',
      'iss',
      'role',
      'sid',
      'sub',
    ]);
  });

  it('rechaza tokens firmados con otra clave aunque usen el mismo kid', async () => {
    const other = new TokenService(testEnv({ JWT_PRIVATE_KEY: testJwtKey() }));
    expect(await tokens.verifyAccessToken(await other.signAccessToken(claims()))).toBeNull();
  });

  it('rechaza un kid desconocido', async () => {
    const other = new TokenService(testEnv({ JWT_KID: 'otro' }));
    expect(await tokens.verifyAccessToken(await other.signAccessToken(claims()))).toBeNull();
  });

  it('rechaza tokens caducados', async () => {
    const { createPrivateKey } = await import('node:crypto');
    const env = testEnv();
    const c = claims();
    const expired = await new SignJWT({ role: c.role, sid: c.sid, amr: c.amr })
      .setProtectedHeader({ alg: 'ES256', kid: env.JWT_KID })
      .setSubject(c.sub)
      .setIssuer('rideapp-api')
      .setAudience('rideapp')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 1000)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 10)
      .sign(createPrivateKey(env.JWT_PRIVATE_KEY));
    expect(await tokens.verifyAccessToken(expired)).toBeNull();
  });

  it('rechaza el algoritmo "none" y basura', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', kid: 'test-1' })).toString(
      'base64url',
    );
    const body = Buffer.from(JSON.stringify(claims())).toString('base64url');
    expect(await tokens.verifyAccessToken(`${header}.${body}.`)).toBeNull();
    expect(await tokens.verifyAccessToken('no-es-un-jwt')).toBeNull();
  });
});

describe('PasswordService', () => {
  const passwords = new PasswordService();

  it('hashea con argon2id y verifica', async () => {
    await passwords.onModuleInit();
    const h = await passwords.hash('una-clave-muy-larga');
    expect(h).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await passwords.verify(h, 'una-clave-muy-larga')).toBe(true);
    expect(await passwords.verify(h, 'otra-clave-muy-larga')).toBe(false);
  });

  it('sin hash (cuenta inexistente) siempre falla', async () => {
    await passwords.onModuleInit();
    expect(await passwords.verify(null, 'lo-que-sea-123')).toBe(false);
  });

  it('rechaza contraseñas comunes, repetitivas o que contienen el email', () => {
    expect(passwords.check('1234567890', 'a@b.co')).toBe('COMMON');
    expect(passwords.check('Password123', 'a@b.co')).toBe('COMMON');
    expect(passwords.check('aaaaaaaaaaaa', 'a@b.co')).not.toBeNull();
    expect(passwords.check('9q9q9q9q9q9q', 'a@b.co')).toBe('REPETITIVE');
    expect(passwords.check('julian-2026-x', 'julian@example.com')).toBe('CONTAINS_EMAIL');
    expect(passwords.check('caballo-azul-girardot', 'ana@example.com')).toBeNull();
  });
});
