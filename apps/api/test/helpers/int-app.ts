import 'reflect-metadata';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { configureApp, createAdapter } from '../../src/app.factory.js';
import { AppModule } from '../../src/app.module.js';
import { MAILER, type Mailer } from '../../src/infra/mail/mailer.js';
import { testEnv } from './test-env.js';

export interface IntegrationApp {
  app: NestFastifyApplication;
  /** Origen HTTP real (para Socket.IO). */
  url: string;
  call: (
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    opts?: {
      body?: unknown;
      token?: string;
      ip?: string;
      headers?: Record<string, string>;
      payload?: Buffer;
    },
  ) => ReturnType<NestFastifyApplication['inject']>;
  stop: () => Promise<void>;
}

const silentMailer: Mailer = { enabled: true, send: async () => undefined };

/**
 * API completa contra Postgres/PostGIS y Redis reales (Testcontainers, sección 16), escuchando en
 * un puerto aleatorio para poder probar también los sockets. Necesita Docker en marcha.
 */
export async function startIntegrationApp(
  overrides: { provide: unknown; useValue: unknown }[] = [],
): Promise<IntegrationApp> {
  const [pg, redis]: [StartedPostgreSqlContainer, StartedRedisContainer] = await Promise.all([
    new PostgreSqlContainer('postgis/postgis:17-3.5').start(),
    new RedisContainer('redis:7-alpine').start(),
  ]);
  const storageDir = mkdtempSync(join(tmpdir(), 'rideapp-storage-'));
  const env = testEnv({
    DATABASE_URL: pg.getConnectionUri(),
    REDIS_URL: redis.getConnectionUrl(),
    STORAGE_DIR: storageDir,
  });
  execSync('npx prisma migrate deploy', {
    cwd: new URL('../..', import.meta.url),
    env: { ...process.env, DATABASE_URL: env.DATABASE_URL },
    stdio: 'pipe',
  });

  let builder = Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(MAILER)
    .useValue(silentMailer);
  for (const o of overrides) builder = builder.overrideProvider(o.provide).useValue(o.useValue);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter(env), {
    bufferLogs: true,
  });
  await configureApp(app, env);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const url = await app.getUrl();

  let ipCounter = 1;
  const freshIp = () => `10.1.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

  return {
    app,
    url: url.replace('[::1]', '127.0.0.1'),
    call: (method, path, opts = {}) =>
      app.inject({
        method,
        url: `/api${path}`,
        payload: opts.payload ?? (opts.body as object | undefined),
        remoteAddress: opts.ip ?? freshIp(),
        headers: {
          ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
          ...opts.headers,
        },
      }),
    stop: async () => {
      await app.close();
      await Promise.all([pg.stop(), redis.stop()]);
      rmSync(storageDir, { recursive: true, force: true });
    },
  };
}

/** Cuerpo multipart/form-data con un solo archivo, para `inject`. */
export function multipartFile(
  data: Buffer,
  { field = 'file', filename = 'doc.bin', contentType = 'application/octet-stream' } = {},
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----rideapp${Math.random().toString(16).slice(2)}`;
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
        `Content-Type: ${contentType}\r\n\r\n`,
    ),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
