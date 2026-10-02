import { type ArgumentMetadata, Injectable, type PipeTransform } from '@nestjs/common';
import { ApiException } from '../errors/api.exception.js';
import { isZodDto } from './zod-dto.js';

/**
 * Pipe global (7.5, paso 6): valida body, query y params cuyo tipo sea un DTO de `createZodDto`.
 * Los esquemas de petición del contrato son `strictObject`, así que los campos desconocidos se rechazan.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (!isZodDto(metadata.metatype)) return value;
    const result = metadata.metatype.schema.safeParse(value);
    if (!result.success) {
      throw new ApiException(
        400,
        'VALIDATION_FAILED',
        'Datos inválidos',
        result.error.issues.map(({ path, code, message }) => ({ path, code, message })),
      );
    }
    return result.data;
  }
}
