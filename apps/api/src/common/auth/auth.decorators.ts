import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AccessTokenClaims, UserRole } from '@rideapp/contracts';
import type { FastifyRequest } from 'fastify';

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const ROLES_KEY = 'auth:roles';

/** Usuario autenticado, tal como lo deja el AuthGuard en la petición. */
export interface AuthUser {
  id: string;
  role: UserRole;
  /** Sesión (familia de refresh tokens). */
  sid: string;
  amr: AccessTokenClaims['amr'];
}

export type AuthenticatedRequest = FastifyRequest & { user?: AuthUser };

/** Ruta sin autenticación. Todo lo demás exige un access token válido (8.1, paso 1). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restringe la ruta a ciertos roles (8.1, paso 2). */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const user = ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
  if (!user) throw new Error('CurrentUser usado en una ruta sin AuthGuard');
  return user;
});

/** IP y user agent para auditoría y sesiones (con TRUST_PROXY, la IP real del cliente). */
export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
}

export const ReqContext = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<FastifyRequest>();
  const ua = req.headers['user-agent'];
  return {
    ip: req.ip ?? null,
    userAgent: typeof ua === 'string' ? ua.slice(0, 256) : null,
  } satisfies RequestContext;
});
