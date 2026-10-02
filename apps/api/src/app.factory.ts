import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import helmet from '@fastify/helmet';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './common/filters/api-exception.filter.js';
import { ZodValidationPipe } from './common/zod/zod-validation.pipe.js';
import type { Env } from './config/env.js';

const REQUEST_ID_HEADER = 'x-request-id';
const VALID_REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Reutiliza el `X-Request-Id` entrante solo si tiene un formato seguro (evita inyección en logs);
 * si no, genera uno. Lo deja en `raw.id` para que pino-http use el mismo (8.1, paso 4).
 */
function genReqId(raw: IncomingMessage): string {
  const header = raw.headers[REQUEST_ID_HEADER];
  const id = typeof header === 'string' && VALID_REQUEST_ID.test(header) ? header : randomUUID();
  (raw as IncomingMessage & { id?: string }).id = id;
  return id;
}

export function createAdapter(env: Env): FastifyAdapter {
  return new FastifyAdapter({
    trustProxy: env.TRUST_PROXY,
    genReqId,
    bodyLimit: 1024 * 1024,
  });
}

export async function createApp(env: Env): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(env),
    createAdapter(env),
    { bufferLogs: true },
  );
  await configureApp(app, env);
  return app;
}

/** Configuración común de la app real y de los tests de integración. */
export async function configureApp(app: NestFastifyApplication, env: Env): Promise<void> {
  app.useLogger(app.get(Logger));

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: env.CORS_ORIGINS,
    credentials: true,
    exposedHeaders: [REQUEST_ID_HEADER],
  });

  await app.register(helmet, {
    // El API solo devuelve JSON. Fuera de producción se relaja para que funcione Swagger UI.
    contentSecurityPolicy:
      env.NODE_ENV === 'production'
        ? { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } }
        : false,
  });

  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new ApiExceptionFilter());

  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onSend', async (req, reply) => {
    void reply.header(REQUEST_ID_HEADER, req.id);
  });

  if (env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('rideapp API')
      .setVersion('0.0.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, config));
  }

  app.enableShutdownHooks();
}
