import type { ErrorCode } from '@rideapp/contracts';

/** Error de negocio con código del contrato `ApiError`. El filtro global lo serializa. */
export class ApiException extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiException';
  }
}
