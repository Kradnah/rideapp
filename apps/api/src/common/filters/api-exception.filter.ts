import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { ApiError, ErrorCode } from '@rideapp/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiException } from '../errors/api.exception.js';

const CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'VALIDATION_FAILED',
  415: 'VALIDATION_FAILED',
  426: 'UPGRADE_REQUIRED',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

const GENERIC_MESSAGE: Partial<Record<ErrorCode, string>> = {
  UNAUTHORIZED: 'No autenticado',
  FORBIDDEN: 'Sin permiso',
  NOT_FOUND: 'No encontrado',
  CONFLICT: 'Conflicto',
  RATE_LIMITED: 'Demasiadas peticiones',
  VALIDATION_FAILED: 'Datos inválidos',
  INTERNAL: 'Error interno',
};

/** Convierte cualquier error en un `ApiError` del contrato (7.5, paso 7). */
export function toApiError(
  err: unknown,
  requestId: string | undefined,
): { status: number; body: ApiError } {
  if (err instanceof ApiException) {
    return {
      status: err.status,
      body: { code: err.code, message: err.message, details: err.details, requestId },
    };
  }

  // HttpException de Nest (404 de rutas, ThrottlerException...) y errores de Fastify con statusCode
  // (JSON mal formado, cuerpo demasiado grande...).
  const status =
    err instanceof HttpException
      ? err.getStatus()
      : typeof (err as { statusCode?: unknown })?.statusCode === 'number'
        ? (err as { statusCode: number }).statusCode
        : 500;

  const code: ErrorCode =
    status >= 500 ? 'INTERNAL' : (CODE_BY_STATUS[status] ?? 'VALIDATION_FAILED');
  // Nunca se reenvía el mensaje original: puede contener detalles internos.
  return {
    status: status >= 400 && status < 600 ? status : 500,
    body: { code, message: GENERIC_MESSAGE[code] ?? 'Error', requestId },
  };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<FastifyRequest>();
    const reply = ctx.getResponse<FastifyReply>();
    const { status, body } = toApiError(exception, req.id);

    if (status >= 500) {
      // La traza va solo al log, nunca a la respuesta.
      this.logger.error({ err: exception, requestId: req.id }, 'Error no controlado');
    }
    void reply.status(status).send(body);
  }
}
