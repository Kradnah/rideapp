import type { z } from 'zod';

/**
 * DTO de Nest respaldado por un esquema Zod de `@rideapp/contracts`.
 *
 *   class RegisterDto extends createZodDto(RegisterRequest) {}
 *   register(@Body() body: RegisterDto) { ... }
 *
 * Sustituye a `nestjs-zod`, que aún no soporta Nest 12 (ver docs/adr/0002).
 */
export interface ZodDto<T extends z.ZodType> {
  new (): z.infer<T>;
  readonly schema: T;
}

export function createZodDto<T extends z.ZodType>(schema: T): ZodDto<T> {
  class Dto {
    static readonly schema = schema;
  }
  return Dto as unknown as ZodDto<T>;
}

export function isZodDto(metatype: unknown): metatype is ZodDto<z.ZodType> {
  return (
    typeof metatype === 'function' &&
    'schema' in metatype &&
    typeof (metatype as { schema?: { safeParse?: unknown } }).schema?.safeParse === 'function'
  );
}
