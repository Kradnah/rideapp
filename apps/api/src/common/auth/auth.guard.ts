import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@rideapp/contracts';
import { SessionRevocationService } from '../../modules/auth/session-revocation.service.js';
import { TokenService } from '../../modules/auth/token.service.js';
import { ApiException } from '../errors/api.exception.js';
import {
  type AuthenticatedRequest,
  IS_PUBLIC_KEY,
  REQUIRE_TOTP_KEY,
  ROLES_KEY,
} from './auth.decorators.js';

/**
 * Guard global: exige un access token válido salvo en rutas @Public() y aplica @Roles().
 * El token va solo en la cabecera Authorization (nunca en la URL, que acaba en los logs).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly revocations: SessionRevocationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer '))
      throw new ApiException(401, 'UNAUTHORIZED', 'No autenticado');

    const claims = await this.tokens.verifyAccessToken(header.slice(7));
    if (!claims) throw new ApiException(401, 'UNAUTHORIZED', 'No autenticado');

    // Cierre de sesión y "cerrar todas" invalidan también los access tokens aún vigentes.
    if (await this.revocations.isRevoked(claims.sid)) {
      throw new ApiException(401, 'UNAUTHORIZED', 'Sesión cerrada');
    }

    req.user = { id: claims.sub, role: claims.role, sid: claims.sid, amr: claims.amr };

    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, targets);
    if (roles && !roles.includes(claims.role)) {
      throw new ApiException(403, 'FORBIDDEN', 'Sin permiso');
    }
    if (
      this.reflector.getAllAndOverride<boolean>(REQUIRE_TOTP_KEY, targets) &&
      !claims.amr.includes('totp')
    ) {
      throw new ApiException(403, 'FORBIDDEN', 'Se requiere el segundo factor');
    }
    return true;
  }
}
