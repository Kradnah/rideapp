import 'reflect-metadata';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { CURRENT_POLICY_VERSION, Me, TokenPair } from '@rideapp/contracts';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureApp, createAdapter } from '../src/app.factory.js';
import { AppModule } from '../src/app.module.js';
import { FieldCrypto } from '../src/common/crypto/field-crypto.js';
import { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { buildTotp, createAdmin } from '../src/modules/admin/admin-provisioning.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { TokenService } from '../src/modules/auth/token.service.js';
import { GOOGLE_VERIFIER, type GoogleTokenVerifier } from '../src/modules/auth/google-verifier.js';
import { testEnv } from './helpers/test-env.js';

/**
 * Integración con Postgres/PostGIS y Redis reales (Testcontainers, sección 16).
 * Necesita Docker en marcha. Cada petición usa una IP distinta salvo donde se prueba
 * el límite por IP, para no chocar con el throttler.
 */
/**
 * Verificador falso: el "idToken" es `google|<sub>|<email>|<verified>|<nonce>`.
 * Así se prueba toda la lógica de cuentas sin llamar a Google.
 */
const fakeGoogle: GoogleTokenVerifier = {
  enabled: true,
  async verify(idToken) {
    const [tag, sub, email, verified] = idToken.split('|');
    if (tag !== 'google' || !sub || !email) return null;
    return {
      sub,
      email,
      emailVerified: verified === 'true',
      name: 'Usuaria Google',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
  },
};
const googleToken = (sub: string, email: string, verified = true) =>
  `google|${sub}|${email}|${verified}|${randomUUID()}`;

let pg: StartedPostgreSqlContainer;
let redis: StartedRedisContainer;
let app: NestFastifyApplication;
let prisma: PrismaService;

beforeAll(async () => {
  [pg, redis] = await Promise.all([
    new PostgreSqlContainer('postgis/postgis:17-3.5').start(),
    new RedisContainer('redis:7-alpine').start(),
  ]);
  const env = testEnv({ DATABASE_URL: pg.getConnectionUri(), REDIS_URL: redis.getConnectionUrl() });
  execSync('npx prisma migrate deploy', {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, DATABASE_URL: env.DATABASE_URL },
    stdio: 'pipe',
  });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(GOOGLE_VERIFIER)
    .useValue(fakeGoogle)
    .compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter(env), {
    bufferLogs: true,
  });
  await configureApp(app, env);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  prisma = app.get(PrismaService);
}, 240_000);

afterAll(async () => {
  await app?.close();
  await Promise.all([pg?.stop(), redis?.stop()]);
});

// ---------- utilidades ----------

let ipCounter = 1;
const freshIp = () => `10.0.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

async function call(
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  opts: { body?: unknown; token?: string; ip?: string; headers?: Record<string, string> } = {},
) {
  return app.inject({
    method,
    url: `/api${url}`,
    payload: opts.body as object | undefined,
    remoteAddress: opts.ip ?? freshIp(),
    headers: {
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...opts.headers,
    },
  });
}

const consent = { acceptTerms: true, policyVersion: CURRENT_POLICY_VERSION };
const PASSWORD = 'caballo-azul-girardot';

async function register(overrides: Record<string, unknown> = {}) {
  const email = `u-${randomUUID()}@example.com`;
  const res = await call('POST', '/auth/register', {
    body: {
      email,
      password: PASSWORD,
      fullName: 'Ana Pérez',
      role: 'PASSENGER',
      consent,
      ...overrides,
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return { email, tokens: TokenPair.parse(res.json()) };
}

// ---------- registro ----------

describe('registro', () => {
  it('crea la cuenta, guarda el consentimiento y audita', async () => {
    const { email, tokens } = await register();
    const me = Me.parse((await call('GET', '/me', { token: tokens.accessToken })).json());
    expect(me).toMatchObject({ email, role: 'PASSENGER', emailVerified: false, status: 'ACTIVE' });

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: me.id },
      include: { consents: true },
    });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.consents).toHaveLength(1);
    expect(user.consents[0]).toMatchObject({
      policyVersion: CURRENT_POLICY_VERSION,
      channel: 'passenger',
    });
    expect(
      await prisma.auditLog.count({ where: { actorId: me.id, action: 'auth.register' } }),
    ).toBe(1);
  });

  it('email duplicado (sin distinguir mayúsculas) → 409 genérico', async () => {
    const { email } = await register();
    const res = await call('POST', '/auth/register', {
      body: {
        email: email.toUpperCase(),
        password: PASSWORD,
        fullName: 'Otra',
        role: 'DRIVER',
        consent,
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'CONFLICT' });
  });

  it('contraseña común → WEAK_PASSWORD; política desactualizada → CONSENT_REQUIRED', async () => {
    const weak = await call('POST', '/auth/register', {
      body: {
        email: `w-${randomUUID()}@example.com`,
        password: '1234567890',
        fullName: 'X Y',
        role: 'PASSENGER',
        consent,
      },
    });
    expect(weak.json()).toMatchObject({ code: 'WEAK_PASSWORD' });

    const old = await call('POST', '/auth/register', {
      body: {
        email: `c-${randomUUID()}@example.com`,
        password: PASSWORD,
        fullName: 'X Y',
        role: 'PASSENGER',
        consent: { acceptTerms: true, policyVersion: '2020-01-01' },
      },
    });
    expect(old.statusCode).toBe(409);
    expect(old.json()).toMatchObject({ code: 'CONSENT_REQUIRED' });
  });
});

// ---------- login ----------

describe('login', () => {
  it('credenciales correctas → tokens; incorrectas o email inexistente → mismo error', async () => {
    const { email } = await register();
    const ok = await call('POST', '/auth/login', { body: { email, password: PASSWORD } });
    expect(ok.statusCode).toBe(200);
    TokenPair.parse(ok.json());

    const wrong = await call('POST', '/auth/login', {
      body: { email, password: 'otra-cosa-larga' },
    });
    const unknown = await call('POST', '/auth/login', {
      body: { email: `nadie-${randomUUID()}@example.com`, password: PASSWORD },
    });
    for (const res of [wrong, unknown]) {
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({
        code: 'INVALID_CREDENTIALS',
        message: 'Credenciales inválidas',
      });
    }
  });

  it('cuenta suspendida → ACCOUNT_DISABLED solo con la contraseña correcta', async () => {
    const { email } = await register();
    await prisma.user.update({ where: { email }, data: { status: 'SUSPENDED' } });
    const bad = await call('POST', '/auth/login', { body: { email, password: 'otra-cosa-larga' } });
    expect(bad.json()).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    const good = await call('POST', '/auth/login', { body: { email, password: PASSWORD } });
    expect(good.statusCode).toBe(403);
    expect(good.json()).toMatchObject({ code: 'ACCOUNT_DISABLED' });
  });

  it('un admin no puede entrar por el login normal', async () => {
    const { email } = await register();
    await prisma.user.update({ where: { email }, data: { role: 'ADMIN' } });
    const res = await call('POST', '/auth/login', { body: { email, password: PASSWORD } });
    expect(res.json()).toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('límite por IP: el sexto intento en un minuto → 429', async () => {
    const ip = freshIp();
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await call('POST', '/auth/login', {
        ip,
        body: { email: `x-${i}@example.com`, password: 'lo-que-sea-123' },
      });
      codes.push(res.statusCode);
    }
    expect(codes.slice(0, 5).every((c) => c === 401)).toBe(true);
    expect(codes[5]).toBe(429);
  });

  it('límite por email desde muchas IPs → 429 aunque la contraseña sea correcta', async () => {
    const { email } = await register();
    for (let i = 0; i < 10; i++) {
      await call('POST', '/auth/login', { body: { email, password: 'mala-clave-123' } });
    }
    const res = await call('POST', '/auth/login', { body: { email, password: PASSWORD } });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ code: 'RATE_LIMITED' });
  });
});

// ---------- sesiones ----------

describe('sesiones', () => {
  it('rota el refresh token en cada uso', async () => {
    const { tokens } = await register();
    const res = await call('POST', '/auth/refresh', {
      body: { refreshToken: tokens.refreshToken },
    });
    expect(res.statusCode).toBe(200);
    const next = TokenPair.parse(res.json());
    expect(next.refreshToken).not.toBe(tokens.refreshToken);
    expect((await call('GET', '/me', { token: next.accessToken })).statusCode).toBe(200);
  });

  it('reutilizar un refresh token ya rotado revoca toda la sesión', async () => {
    const { tokens } = await register();
    const rotated = TokenPair.parse(
      (await call('POST', '/auth/refresh', { body: { refreshToken: tokens.refreshToken } })).json(),
    );

    // Un atacante usa el token viejo:
    const reuse = await call('POST', '/auth/refresh', {
      body: { refreshToken: tokens.refreshToken },
    });
    expect(reuse.statusCode).toBe(401);

    // La sesión entera queda muerta: el token nuevo y el access token también.
    const legit = await call('POST', '/auth/refresh', {
      body: { refreshToken: rotated.refreshToken },
    });
    expect(legit.statusCode).toBe(401);
    expect((await call('GET', '/me', { token: rotated.accessToken })).statusCode).toBe(401);
  });

  it('dos refrescos simultáneos con el mismo token: solo uno gana', async () => {
    const { tokens } = await register();
    const results = await Promise.all(
      [1, 2].map(() =>
        call('POST', '/auth/refresh', { body: { refreshToken: tokens.refreshToken } }),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 401]);
  });

  it('logout invalida el access token y el refresh token de esa sesión', async () => {
    const { tokens } = await register();
    expect((await call('POST', '/auth/logout', { token: tokens.accessToken })).statusCode).toBe(
      204,
    );
    expect((await call('GET', '/me', { token: tokens.accessToken })).statusCode).toBe(401);
    expect(
      (await call('POST', '/auth/refresh', { body: { refreshToken: tokens.refreshToken } }))
        .statusCode,
    ).toBe(401);
  });

  it('logout-all cierra todas las sesiones del usuario', async () => {
    const { email, tokens: s1 } = await register();
    const s2 = TokenPair.parse(
      (await call('POST', '/auth/login', { body: { email, password: PASSWORD } })).json(),
    );
    expect((await call('POST', '/auth/logout-all', { token: s1.accessToken })).statusCode).toBe(
      204,
    );
    expect((await call('GET', '/me', { token: s1.accessToken })).statusCode).toBe(401);
    expect((await call('GET', '/me', { token: s2.accessToken })).statusCode).toBe(401);
  });

  it('refresh token inventado → 401', async () => {
    const res = await call('POST', '/auth/refresh', { body: { refreshToken: 'inventado' } });
    expect(res.statusCode).toBe(401);
  });
});

// ---------- perfil ----------

describe('/me', () => {
  it('exige token y rechaza tokens manipulados', async () => {
    expect((await call('GET', '/me')).statusCode).toBe(401);
    const { tokens } = await register();
    const [h, p, s] = tokens.accessToken.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(p!, 'base64url').toString()), role: 'ADMIN' }),
    ).toString('base64url');
    expect((await call('GET', '/me', { token: `${h}.${forged}.${s}` })).statusCode).toBe(401);
  });

  it('actualiza nombre y teléfono; rechaza campos desconocidos y formatos inválidos', async () => {
    const { tokens } = await register();
    const ok = await call('PATCH', '/me', {
      token: tokens.accessToken,
      body: { fullName: 'Ana María', phone: '+573001234567' },
    });
    expect(Me.parse(ok.json())).toMatchObject({ fullName: 'Ana María', phone: '+573001234567' });

    const role = await call('PATCH', '/me', { token: tokens.accessToken, body: { role: 'ADMIN' } });
    expect(role.statusCode).toBe(400);
    const phone = await call('PATCH', '/me', {
      token: tokens.accessToken,
      body: { phone: '3001234567' },
    });
    expect(phone.statusCode).toBe(400);
  });
});

// ---------- Google ----------

describe('login con Google', () => {
  it('cuenta nueva: pide consentimiento y acepta reintentar con el mismo token', async () => {
    const sub = randomUUID();
    const email = `g-${sub}@gmail.com`;
    const idToken = googleToken(sub, email);

    const first = await call('POST', '/auth/google', { body: { idToken, role: 'DRIVER' } });
    expect(first.statusCode).toBe(409);
    expect(first.json()).toMatchObject({ code: 'CONSENT_REQUIRED' });

    const second = await call('POST', '/auth/google', {
      body: { idToken, role: 'DRIVER', consent },
    });
    expect(second.statusCode, second.body).toBe(200);
    const pair = TokenPair.parse(second.json());
    const claims = JSON.parse(Buffer.from(pair.accessToken.split('.')[1]!, 'base64url').toString());
    expect(claims.amr).toEqual(['google']);

    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      include: { identities: true, consents: true },
    });
    expect(user).toMatchObject({ role: 'DRIVER', emailVerified: true, passwordHash: null });
    expect(user.identities).toMatchObject([{ provider: 'GOOGLE', providerSubject: sub }]);
    expect(user.consents[0]).toMatchObject({ channel: 'driver' });
  });

  it('el mismo idToken no abre dos sesiones (anti-replay)', async () => {
    const sub = randomUUID();
    const idToken = googleToken(sub, `r-${sub}@gmail.com`);
    expect((await call('POST', '/auth/google', { body: { idToken, consent } })).statusCode).toBe(
      200,
    );
    expect((await call('POST', '/auth/google', { body: { idToken, consent } })).statusCode).toBe(
      401,
    );
  });

  it('identifica por sub: el mismo usuario aunque cambie el email en Google', async () => {
    const sub = randomUUID();
    const a = await call('POST', '/auth/google', {
      body: { idToken: googleToken(sub, `a-${sub}@gmail.com`), consent },
    });
    const b = await call('POST', '/auth/google', {
      body: { idToken: googleToken(sub, `nuevo-${sub}@gmail.com`) },
    });
    const meA = Me.parse(
      (await call('GET', '/me', { token: TokenPair.parse(a.json()).accessToken })).json(),
    );
    const meB = Me.parse(
      (await call('GET', '/me', { token: TokenPair.parse(b.json()).accessToken })).json(),
    );
    expect(meB.id).toBe(meA.id);
  });

  it('rechaza cuentas de Google sin email verificado y tokens inválidos', async () => {
    const sub = randomUUID();
    const unverified = await call('POST', '/auth/google', {
      body: { idToken: googleToken(sub, `u-${sub}@gmail.com`, false), consent },
    });
    expect(unverified.statusCode).toBe(401);
    const invalid = await call('POST', '/auth/google', {
      body: { idToken: 'no-es-de-google', consent },
    });
    expect(invalid.statusCode).toBe(401);
  });

  it('NO vincula una cuenta con contraseña y email sin verificar (toma de cuenta)', async () => {
    const { email } = await register();
    const res = await call('POST', '/auth/google', {
      body: { idToken: googleToken(randomUUID(), email), consent },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'CONFLICT' });
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      include: { identities: true },
    });
    expect(user.identities).toHaveLength(0);
  });

  it('vincula una cuenta existente con email verificado y lo audita', async () => {
    const { email } = await register();
    const user = await prisma.user.update({ where: { email }, data: { emailVerified: true } });
    const sub = randomUUID();
    const res = await call('POST', '/auth/google', { body: { idToken: googleToken(sub, email) } });
    expect(res.statusCode).toBe(200);
    expect(
      await prisma.authIdentity.count({
        where: { userId: user.id, provider: 'GOOGLE', providerSubject: sub },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({ where: { actorId: user.id, action: 'auth.google_linked' } }),
    ).toBe(1);
  });
});

// ---------- Panel admin (TOTP) ----------

describe('login del panel con TOTP', () => {
  const ADMIN_PASSWORD = 'panel-girardot-seguro-2026';

  async function newAdmin() {
    const email = `admin-${randomUUID()}@example.com`;
    const created = await createAdmin(
      { prisma, crypto: app.get(FieldCrypto), passwords: new PasswordService() },
      { email, fullName: 'Admin Demo', password: ADMIN_PASSWORD },
    );
    return { email, totp: buildTotp(created.secretBase32, email) };
  }

  /** Cookies de la respuesta: crudas, como mapa y como cabecera Cookie. */
  function cookiesOf(res: Awaited<ReturnType<typeof call>>) {
    const raw = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const jar = Object.fromEntries(
      raw.map((c) => {
        const pair = c.split(';')[0]!;
        const i = pair.indexOf('=');
        return [pair.slice(0, i), pair.slice(i + 1)];
      }),
    );
    return { raw, jar, header: raw.map((c) => c.split(';')[0]).join('; ') };
  }

  async function passwordStep(email: string) {
    const res = await call('POST', '/auth/admin/login', {
      body: { email, password: ADMIN_PASSWORD },
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { challengeId: string }).challengeId;
  }

  async function fullLogin() {
    const admin = await newAdmin();
    const challengeId = await passwordStep(admin.email);
    const res = await call('POST', '/auth/admin/totp', {
      body: { challengeId, code: admin.totp.generate() },
    });
    expect(res.statusCode, res.body).toBe(200);
    return { admin, res, session: res.json() as { accessToken: string } };
  }

  it('contraseña + código → sesión con amr pwd,totp y cookies __Host- seguras', async () => {
    const { res, session } = await fullLogin();
    const rt = cookiesOf(res).raw.find((c) => c.startsWith('__Host-rideapp_admin_rt='))!;
    expect(rt).toMatch(/HttpOnly/i);
    expect(rt).toMatch(/Secure/i);
    expect(rt).toMatch(/SameSite=Strict/i);
    expect(rt).toMatch(/Path=\//);
    expect(rt).not.toMatch(/Domain=/i);
    expect(res.body).not.toContain('refreshToken');

    const claims = JSON.parse(
      Buffer.from(session.accessToken.split('.')[1]!, 'base64url').toString(),
    );
    expect(claims).toMatchObject({ role: 'ADMIN', amr: ['pwd', 'totp'] });
    const overview = await call('GET', '/admin/overview', { token: session.accessToken });
    expect(overview.statusCode).toBe(200);
    expect(overview.json()).toMatchObject({ users: { admins: expect.any(Number) } });
  });

  it('contraseña incorrecta, usuario no admin o código incorrecto → error genérico', async () => {
    const admin = await newAdmin();
    const bad = await call('POST', '/auth/admin/login', {
      body: { email: admin.email, password: 'mala-clave-123' },
    });
    expect(bad.json()).toMatchObject({ code: 'INVALID_CREDENTIALS' });

    const { email } = await register();
    const passenger = await call('POST', '/auth/admin/login', {
      body: { email, password: PASSWORD },
    });
    expect(passenger.json()).toMatchObject({ code: 'INVALID_CREDENTIALS' });

    const challengeId = await passwordStep(admin.email);
    const wrong = await call('POST', '/auth/admin/totp', { body: { challengeId, code: '000000' } });
    expect(wrong.statusCode).toBe(401);
  });

  it('un código ya usado no sirve para otro login (anti-replay del TOTP)', async () => {
    const admin = await newAdmin();
    const code = admin.totp.generate();
    for (const expected of [200, 401]) {
      const challengeId = await passwordStep(admin.email);
      const res = await call('POST', '/auth/admin/totp', { body: { challengeId, code } });
      expect(res.statusCode).toBe(expected);
    }
  });

  it('el reto se bloquea tras 5 códigos incorrectos', async () => {
    const admin = await newAdmin();
    const challengeId = await passwordStep(admin.email);
    for (let i = 0; i < 5; i++) {
      await call('POST', '/auth/admin/totp', { body: { challengeId, code: '000000' } });
    }
    const blocked = await call('POST', '/auth/admin/totp', {
      body: { challengeId, code: admin.totp.generate() },
    });
    expect(blocked.statusCode).toBe(429);
  });

  it('refresh y logout por cookie exigen el token CSRF', async () => {
    const { res } = await fullLogin();
    const { jar, header } = cookiesOf(res);

    const noCsrf = await call('POST', '/auth/admin/refresh', { headers: { cookie: header } });
    expect(noCsrf.statusCode).toBe(403);

    const ok = await call('POST', '/auth/admin/refresh', {
      headers: { cookie: header, 'x-csrf-token': jar['__Host-rideapp_admin_csrf']! },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const next = cookiesOf(ok);
    const nextHeaders = {
      cookie: next.header,
      'x-csrf-token': next.jar['__Host-rideapp_admin_csrf']!,
    };

    expect((await call('POST', '/auth/admin/logout', { headers: nextHeaders })).statusCode).toBe(
      204,
    );
    expect((await call('POST', '/auth/admin/refresh', { headers: nextHeaders })).statusCode).toBe(
      401,
    );
  });

  it('la sesión del panel caduca por inactividad', async () => {
    const { res } = await fullLogin();
    const { jar, header } = cookiesOf(res);
    // Simula 31 minutos sin uso: el token vigente ya está vencido.
    await prisma.refreshToken.updateMany({
      where: { revokedAt: null, idleSeconds: { not: null } },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    const expired = await call('POST', '/auth/admin/refresh', {
      headers: { cookie: header, 'x-csrf-token': jar['__Host-rideapp_admin_csrf']! },
    });
    expect(expired.statusCode).toBe(401);
  });

  it('/admin/* exige rol ADMIN y segundo factor', async () => {
    const { tokens } = await register();
    expect((await call('GET', '/admin/overview', { token: tokens.accessToken })).statusCode).toBe(
      403,
    );

    // Un token de admin sin 'totp' en amr (solo contraseña) no basta.
    const pwdOnly = await app.get(TokenService).signAccessToken({
      sub: randomUUID(),
      role: 'ADMIN',
      sid: randomUUID(),
      amr: ['pwd'],
    });
    expect((await call('GET', '/admin/overview', { token: pwdOnly })).statusCode).toBe(403);
  });

  it('la sesión de Google conserva amr google al refrescar', async () => {
    const sub = randomUUID();
    const res = await call('POST', '/auth/google', {
      body: { idToken: googleToken(sub, `amr-${sub}@gmail.com`), consent },
    });
    const pair = TokenPair.parse(res.json());
    const refreshed = TokenPair.parse(
      (await call('POST', '/auth/refresh', { body: { refreshToken: pair.refreshToken } })).json(),
    );
    const claims = JSON.parse(
      Buffer.from(refreshed.accessToken.split('.')[1]!, 'base64url').toString(),
    );
    expect(claims.amr).toEqual(['google']);
  });
});
