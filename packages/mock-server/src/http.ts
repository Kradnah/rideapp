import type { ErrorCode } from '@rideapp/contracts';
import type { z } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new HttpError(400, 'VALIDATION_FAILED', 'Datos inválidos', result.error.issues);
  }
  return result.data;
}

/** Valida también las respuestas: el mock nunca puede prometer algo que el contrato no permite. */
export function send<T extends z.ZodType>(schema: T, data: z.input<T>): z.infer<T> {
  return schema.parse(data);
}
