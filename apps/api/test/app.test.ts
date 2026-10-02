import 'reflect-metadata';
import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { getStorageToken } from '@nestjs/throttler';
import { ApiError, HealthResponse, RegisterRequest } from '@rideapp/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { configureApp, createAdapter } from '../src/app.factory.js';
import { AppModule } from '../src/app.module.js';
import { ApiException } from '../src/common/errors/api.exception.js';
import { createZodDto } from '../src/common/zod/zod-dto.js';
import { parseEnv } from '../src/config/env.js';
import { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { RedisService } from '../src/infra/redis/redis.service.js';

// ---------- Controlador de prueba para ejercitar pipe y filtro ----------

class RegisterDto extends createZodDto(RegisterRequest) {}

@Controller('test')
class ProbeController {
  @Post('register')
  register(@Body() body: RegisterDto) {
    return { email: body.email };
  }

  @Get('conflict')
  conflict() {
    throw new ApiException(409, 'ACTIVE_TRIP_EXISTS', 'Ya tienes un viaje activo');
  }

  @Get('boom')
  boom() {
    throw new Error('detalle interno que no debe salir: password=123');
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

// ---------- Dobles de Postgres y Redis ----------

function fakeDeps(opts: { dbUp: boolean; redisUp: boolean }) {
  const hits = new Map<string, number>();
  return {
    prisma: {
      ping: async () => {
        if (!opts.dbUp) throw new Error('down');
      },
      onModuleDestroy: async () => {},
    },
    redis: {
      client: {},
      ping: async () => {
        if (!opts.redisUp) throw new Error('down');
      },
      onModuleDestroy: async () => {},
    },
    // Throttler en memoria con límite real, para no depender de Redis.
    throttlerStorage: {
      increment: async (key: string, ttl: number, limit: number) => {
        const n = (hits.get(key) ?? 0) + 1;
        hits.set(key, n);
        return {
          totalHits: n,
          timeToExpire: ttl / 1000,
          isBlocked: n > limit,
          timeToBlockExpire: 0,
        };
      },
    },
  };
}

let app: NestFastifyApplication | undefined;

async function startApp(
  opts = { dbUp: true, redisUp: true },
  envOverrides: Record<string, string> = {},
) {
  const env = parseEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/x',
    REDIS_URL: 'redis://127.0.0.1:1',
    CORS_ORIGINS: 'http://localhost:5173',
    ...envOverrides,
  });
  const deps = fakeDeps(opts);
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(env), ProbeModule],
  })
    .overrideProvider(PrismaService)
    .useValue(deps.prisma)
    .overrideProvider(RedisService)
    .useValue(deps.redis)
    .overrideProvider(getStorageToken())
    .useValue(deps.throttlerStorage)
    .compile();

  app = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter(env), {
    bufferLogs: true,
  });
  await configureApp(app, env);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('health', () => {
  it('live siempre responde ok', async () => {
    const a = await startApp({ dbUp: false, redisUp: false });
    const res = await a.inject({ method: 'GET', url: '/api/health/live' });
    expect(res.statusCode).toBe(200);
    expect(HealthResponse.parse(res.json())).toEqual({ status: 'ok' });
  });

  it('ready → 200 con todo arriba', async () => {
    const a = await startApp();
    const res = await a.inject({ method: 'GET', url: '/api/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', checks: { database: 'up', redis: 'up' } });
  });

  it('ready → 503 si cae Redis', async () => {
    const a = await startApp({ dbUp: true, redisUp: false });
    const res = await a.inject({ method: 'GET', url: '/api/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'error', checks: { database: 'up', redis: 'down' } });
  });
});

describe('validación y errores', () => {
  const valid = {
    email: 'ana@example.com',
    password: 'una-clave-larga',
    fullName: 'Ana',
    role: 'PASSENGER',
  };

  it('acepta un cuerpo válido', async () => {
    const a = await startApp();
    const res = await a.inject({ method: 'POST', url: '/api/test/register', payload: valid });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ email: 'ana@example.com' });
  });

  it('rechaza campos desconocidos con ApiError', async () => {
    const a = await startApp();
    const res = await a.inject({
      method: 'POST',
      url: '/api/test/register',
      payload: { ...valid, role: 'ADMIN', isAdmin: true },
    });
    expect(res.statusCode).toBe(400);
    const body = ApiError.parse(res.json());
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.requestId).toBeTruthy();
  });

  it('JSON mal formado también devuelve ApiError', async () => {
    const a = await startApp();
    const res = await a.inject({
      method: 'POST',
      url: '/api/test/register',
      headers: { 'content-type': 'application/json' },
      payload: '{"email":',
    });
    expect(res.statusCode).toBe(400);
    expect(ApiError.parse(res.json()).code).toBe('VALIDATION_FAILED');
  });

  it('ApiException conserva su código', async () => {
    const a = await startApp();
    const res = await a.inject({ method: 'GET', url: '/api/test/conflict' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'ACTIVE_TRIP_EXISTS' });
  });

  it('un error inesperado no filtra detalles', async () => {
    const a = await startApp();
    const res = await a.inject({ method: 'GET', url: '/api/test/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ code: 'INTERNAL', message: 'Error interno' });
    expect(res.body).not.toContain('password');
    expect(res.body).not.toContain('stack');
  });

  it('ruta inexistente → 404 con ApiError', async () => {
    const a = await startApp();
    const res = await a.inject({ method: 'GET', url: '/api/no-existe' });
    expect(res.statusCode).toBe(404);
    expect(ApiError.parse(res.json()).code).toBe('NOT_FOUND');
  });
});

describe('cabeceras y request id', () => {
  it('reutiliza un X-Request-Id válido y descarta uno peligroso', async () => {
    const a = await startApp();
    const ok = await a.inject({
      method: 'GET',
      url: '/api/health/live',
      headers: { 'x-request-id': 'abc12345-de' },
    });
    expect(ok.headers['x-request-id']).toBe('abc12345-de');

    const bad = await a.inject({
      method: 'GET',
      url: '/api/health/live',
      headers: { 'x-request-id': 'x\n{"level":60}' },
    });
    expect(bad.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('aplica cabeceras de seguridad de helmet', async () => {
    const a = await startApp();
    const res = await a.inject({ method: 'GET', url: '/api/health/live' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
  });

  it('CORS solo para orígenes de la lista blanca', async () => {
    const a = await startApp();
    const allowed = await a.inject({
      method: 'GET',
      url: '/api/health/live',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const denied = await a.inject({
      method: 'GET',
      url: '/api/health/live',
      headers: { origin: 'https://evil.example.com' },
    });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('rate limiting', () => {
  it('responde 429 con ApiError al superar el límite', async () => {
    const a = await startApp();
    let last;
    for (let i = 0; i < 121; i++) {
      last = await a.inject({ method: 'GET', url: '/api/test/conflict' });
    }
    expect(last!.statusCode).toBe(429);
    expect(ApiError.parse(last!.json()).code).toBe('RATE_LIMITED');
  });
});
