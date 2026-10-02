import type { IncomingMessage } from 'node:http';
import { RequestMethod } from '@nestjs/common';
import type { Params } from 'nestjs-pino';
import type { Env } from '../../config/env.js';

/** Campos que nunca deben llegar a los logs (7.5, paso 5). */
const SENSITIVE_KEYS = [
  'password',
  'idToken',
  'refreshToken',
  'accessToken',
  'lat',
  'lng',
  'phone',
  'email',
];

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  ...SENSITIVE_KEYS,
  ...SENSITIVE_KEYS.map((k) => `*.${k}`),
  ...SENSITIVE_KEYS.map((k) => `*.*.${k}`),
];

export function loggerOptions(env: Env): Params {
  return {
    // Las sondas de Dokploy llegan cada pocos segundos: no se registran.
    exclude: [{ method: RequestMethod.GET, path: 'health/{*path}' }],
    pinoHttp: {
      level: env.LOG_LEVEL,
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      // Fastify ya generó el id (ver app.factory.ts): pino-http lo reutiliza desde req.id.
      genReqId: (req: IncomingMessage) =>
        (req as IncomingMessage & { id?: string }).id ?? 'unknown',
      serializers: {
        // Sin query string: puede llevar coordenadas (?lat=&lng=) u otros datos personales.
        req: (req: { id: string; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url.split('?')[0],
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      transport:
        env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' } }
          : undefined,
    },
  };
}
