import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { APP_VERSION_HEADER, AppVersion, compareVersions } from '@rideapp/contracts';
import type { FastifyRequest } from 'fastify';
import { InjectEnv } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { ApiException } from '../errors/api.exception.js';

/**
 * Versión mínima de las apps (14.5): si la petición trae `X-App-Version` y es menor que
 * `MIN_APP_VERSION`, responde `426 UPGRADE_REQUIRED`. Las apps la envían desde la Fase 1
 * (`api-client`); el panel no, porque se despliega junto con el API.
 */
@Injectable()
export class AppVersionGuard implements CanActivate {
  constructor(@InjectEnv() private readonly env: Env) {}

  canActivate(context: ExecutionContext): boolean {
    const min = this.env.MIN_APP_VERSION;
    if (!min || context.getType() !== 'http') return true;
    const header = context.switchToHttp().getRequest<FastifyRequest>().headers[APP_VERSION_HEADER];
    if (typeof header !== 'string') return true;
    const version = AppVersion.safeParse(header);
    if (version.success && compareVersions(version.data, min) >= 0) return true;
    throw new ApiException(426, 'UPGRADE_REQUIRED', 'Actualiza la app para continuar.', {
      minVersion: min,
    });
  }
}
