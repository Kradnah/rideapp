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
import { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { testEnv } from './helpers/test-env.js';

/**
 * Integración con Postgres/PostGIS y Redis reales (Testcontainers, sección 16).
 * Necesita Docker en marcha. Cada petición usa una IP distinta salvo donde se prueba
 * el límite por IP, para no chocar con el throttler.
 */
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

  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
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
  opts: { body?: unknown; token?: string; ip?: string } = {},
) {
  return app.inject({
    method,
    url: `/api${url}`,
    payload: opts.body as object | undefined,
    remoteAddress: opts.ip ?? freshIp(),
    headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
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
