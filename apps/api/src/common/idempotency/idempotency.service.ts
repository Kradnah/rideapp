import { Injectable } from '@nestjs/common';
import { IdempotencyKey } from '@rideapp/contracts';
import { RedisService } from '../../infra/redis/redis.service.js';
import { ApiException } from '../errors/api.exception.js';

const TTL_SECONDS = 24 * 3600;
const PENDING = '__pending__';

/**
 * Cabecera `Idempotency-Key` (8.8, paso 5): un reintento por mala conexión con la misma clave
 * devuelve el resultado del primer intento en vez de repetir la acción. Se guarda 24 h en Redis,
 * por usuario, solo la referencia al resultado (p. ej. el id del viaje).
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly redis: RedisService) {}

  /** Valida la cabecera; undefined si no vino. */
  parseKey(header: string | string[] | undefined): string | undefined {
    if (header === undefined) return undefined;
    const parsed = IdempotencyKey.safeParse(Array.isArray(header) ? header[0] : header);
    if (!parsed.success) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Idempotency-Key no válida');
    }
    return parsed.data;
  }

  async run<T>(
    scope: string,
    userId: string,
    key: string | undefined,
    action: () => Promise<{ result: T; ref: string }>,
    replay: (ref: string) => Promise<T>,
  ): Promise<T> {
    if (!key) return (await action()).result;

    const redisKey = `idem:${scope}:${userId}:${key}`;
    const claimed = await this.redis.client.set(redisKey, PENDING, 'EX', TTL_SECONDS, 'NX');
    if (claimed !== 'OK') {
      const ref = await this.redis.client.get(redisKey);
      if (ref === PENDING) {
        throw new ApiException(409, 'CONFLICT', 'La solicitud anterior todavía se está procesando');
      }
      if (ref) return replay(ref);
    }
    try {
      const { result, ref } = await action();
      await this.redis.client.set(redisKey, ref, 'EX', TTL_SECONDS);
      return result;
    } catch (err) {
      // Un fallo no se recuerda: el cliente puede reintentar con la misma clave.
      await this.redis.client.del(redisKey);
      throw err;
    }
  }
}
