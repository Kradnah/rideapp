import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { DRIVER_DOCUMENT_MAX_BYTES } from '@rideapp/contracts';
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
    // 14.1: JSON pequeño. Las subidas (multipart) tienen su propio límite más abajo.
    bodyLimit: 100 * 1024,
    // Los place_id de Google de direcciones pasan de los 100 caracteres por defecto de Fastify,
    // que respondería 414 en /geo/place/:placeId. El mismo tope que valida PlaceParam.
    routerOptions: { maxParamLength: 300 },
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

  // Cookies de sesión del panel (11.1). Sin firma: el refresh token ya es aleatorio e inadivinable.
  await app.register(cookie);

  await app.register(helmet, {
    // El API solo devuelve JSON. Fuera de producción se relaja para que funcione Swagger UI.
    contentSecurityPolicy:
      env.NODE_ENV === 'production'
        ? { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } }
        : false,
  });

  // Subidas (documentos de conductores, 8.4): un solo archivo por petición y tope de tamaño propio.
  await app.register(multipart, {
    limits: {
      fileSize: DRIVER_DOCUMENT_MAX_BYTES,
      files: 1,
      fields: 0,
      parts: 1,
      headerPairs: 20,
    },
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
