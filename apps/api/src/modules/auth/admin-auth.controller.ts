import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  type AdminLoginChallenge,
  type AdminSession,
  AdminTotpRequest,
  CSRF_HEADER,
  LoginRequest,
} from '@rideapp/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public, ReqContext, type RequestContext } from '../../common/auth/auth.decorators.js';
import { ApiException } from '../../common/errors/api.exception.js';
import { createZodDto } from '../../common/zod/zod-dto.js';
import { type AdminSessionResult, AdminAuthService } from './admin-auth.service.js';

class AdminLoginDto extends createZodDto(LoginRequest) {}
class AdminTotpDto extends createZodDto(AdminTotpRequest) {}

/**
 * Cookies `__Host-`: obligan a Secure, Path=/ y sin Domain, así que no se comparten con otros
 * subdominios de julian-lizcano.com ni pueden ser sobrescritas por ellos (11.1, paso 2).
 */
export const ADMIN_REFRESH_COOKIE = '__Host-rideapp_admin_rt';
export const ADMIN_CSRF_COOKIE = '__Host-rideapp_admin_csrf';

const STRICT = { default: { limit: 5, ttl: 60_000 } };

function setSessionCookies(reply: FastifyReply, session: AdminSessionResult): void {
  const base = {
    path: '/',
    secure: true,
    sameSite: 'strict' as const,
    expires: session.refreshExpiresAt,
  };
  void reply.setCookie(ADMIN_REFRESH_COOKIE, session.refreshToken, { ...base, httpOnly: true });
  // Double-submit: JS lee esta cookie y la repite en la cabecera X-CSRF-Token.
  void reply.setCookie(ADMIN_CSRF_COOKIE, randomBytes(24).toString('base64url'), {
    ...base,
    httpOnly: false,
  });
}

function clearSessionCookies(reply: FastifyReply): void {
  for (const name of [ADMIN_REFRESH_COOKIE, ADMIN_CSRF_COOKIE]) {
    void reply.clearCookie(name, { path: '/', secure: true, sameSite: 'strict' });
  }
}

/** Las rutas que actúan con la cookie de sesión exigen que la cabecera CSRF coincida con su cookie. */
function assertCsrf(req: FastifyRequest): void {
  const cookie = req.cookies[ADMIN_CSRF_COOKIE];
  const header = req.headers[CSRF_HEADER];
  const ok =
    typeof cookie === 'string' &&
    typeof header === 'string' &&
    cookie.length === header.length &&
    timingSafeEqual(Buffer.from(cookie), Buffer.from(header));
  if (!ok) throw new ApiException(403, 'FORBIDDEN', 'Falta el token CSRF');
}

const toSession = (s: AdminSessionResult): AdminSession => ({
  accessToken: s.accessToken,
  expiresIn: s.expiresIn,
});

@Controller('auth/admin')
export class AdminAuthController {
  constructor(private readonly adminAuth: AdminAuthService) {}

  @Public()
  @Throttle(STRICT)
  @HttpCode(200)
  @Post('login')
  login(
    @Body() body: AdminLoginDto,
    @ReqContext() ctx: RequestContext,
  ): Promise<AdminLoginChallenge> {
    return this.adminAuth.login(body, ctx);
  }

  @Public()
  @Throttle(STRICT)
  @HttpCode(200)
  @Post('totp')
  async totp(
    @Body() body: AdminTotpDto,
    @ReqContext() ctx: RequestContext,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AdminSession> {
    const session = await this.adminAuth.verifyTotp(body, ctx);
    setSessionCookies(reply, session);
    return toSession(session);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post('refresh')
  async refresh(
    @Req() req: FastifyRequest,
    @ReqContext() ctx: RequestContext,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AdminSession> {
    assertCsrf(req);
    const raw = req.cookies[ADMIN_REFRESH_COOKIE];
    if (!raw) throw new ApiException(401, 'UNAUTHORIZED', 'Sin sesión');
    try {
      const session = await this.adminAuth.refresh(raw, ctx);
      setSessionCookies(reply, session);
      return toSession(session);
    } catch (err) {
      clearSessionCookies(reply);
      throw err;
    }
  }

  @Public()
  @HttpCode(204)
  @Post('logout')
  async logout(
    @Req() req: FastifyRequest,
    @ReqContext() ctx: RequestContext,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    assertCsrf(req);
    await this.adminAuth.logout(req.cookies[ADMIN_REFRESH_COOKIE], ctx);
    clearSessionCookies(reply);
  }
}
