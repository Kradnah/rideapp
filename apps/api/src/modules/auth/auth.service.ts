import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  CURRENT_POLICY_VERSION,
  type LoginRequest,
  type RegisterRequest,
  type TokenPair,
} from '@rideapp/contracts';
import type { AuthUser, RequestContext } from '../../common/auth/auth.decorators.js';
import { ApiException } from '../../common/errors/api.exception.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { User } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { RedisService } from '../../infra/redis/redis.service.js';
import { AuditService } from '../audit/audit.service.js';
import { UsersService } from '../users/users.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';
import { TokenService } from './token.service.js';

/** Intentos de login por email (cualquier IP) en la ventana, además del límite por IP (8.2, paso 5). */
const LOGIN_EMAIL_LIMIT = 10;
const LOGIN_EMAIL_WINDOW_S = 15 * 60;

const emailHash = (email: string) => createHash('sha256').update(email).digest('hex').slice(0, 32);

const invalidCredentials = () =>
  new ApiException(401, 'INVALID_CREDENTIALS', 'Credenciales inválidas');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  async register(body: RegisterRequest, ctx: RequestContext): Promise<TokenPair> {
    if (body.consent.policyVersion !== CURRENT_POLICY_VERSION) {
      throw new ApiException(409, 'CONSENT_REQUIRED', 'Acepta la política de tratamiento vigente');
    }
    const problem = this.passwords.check(body.password, body.email);
    if (problem) {
      throw new ApiException(400, 'WEAK_PASSWORD', 'Elige una contraseña menos predecible', {
        reason: problem,
      });
    }

    const passwordHash = await this.passwords.hash(body.password);
    let user: User;
    try {
      user = await this.prisma.user.create({
        data: {
          email: body.email,
          passwordHash,
          fullName: body.fullName,
          role: body.role,
          consents: {
            create: {
              policyVersion: body.consent.policyVersion,
              ip: ctx.ip,
              channel: body.role === 'DRIVER' ? 'driver' : 'passenger',
            },
          },
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ApiException(409, 'CONFLICT', 'No se pudo completar el registro');
      }
      throw err;
    }

    await this.audit.log({
      actorId: user.id,
      action: 'auth.register',
      entity: 'user',
      entityId: user.id,
      ip: ctx.ip,
      meta: { method: 'password', role: user.role },
    });
    return this.issue(user, ['pwd'], ctx);
  }

  async login(body: LoginRequest, ctx: RequestContext): Promise<TokenPair> {
    await this.enforceEmailRateLimit(body.email);

    const user = await this.users.findByEmail(body.email);
    const ok = await this.passwords.verify(user?.passwordHash, body.password);
    // Los administradores entran por /auth/admin/login con TOTP (8.14).
    if (!user || !ok || user.role === 'ADMIN') {
      await this.audit.log({
        actorId: user?.id ?? null,
        action: 'auth.login_failed',
        entity: 'user',
        entityId: user?.id ?? null,
        ip: ctx.ip,
        meta: { emailHash: emailHash(body.email) },
      });
      throw invalidCredentials();
    }
    // Solo se informa del estado de la cuenta a quien ya demostró conocer la contraseña.
    if (user.status !== 'ACTIVE') {
      throw new ApiException(403, 'ACCOUNT_DISABLED', 'Tu cuenta no está activa');
    }

    await this.audit.log({
      actorId: user.id,
      action: 'auth.login',
      entity: 'user',
      entityId: user.id,
      ip: ctx.ip,
      meta: { method: 'password' },
    });
    return this.issue(user, ['pwd'], ctx);
  }

  async refresh(refreshToken: string, ctx: RequestContext): Promise<TokenPair> {
    const result = await this.sessions.rotate(refreshToken, ctx);
    if (!result.ok) throw new ApiException(401, 'UNAUTHORIZED', 'Sesión inválida');

    const user = await this.users.findActiveById(result.userId);
    if (!user || user.status !== 'ACTIVE') {
      await this.sessions.revokeFamily(result.familyId);
      throw new ApiException(401, 'UNAUTHORIZED', 'Sesión inválida');
    }
    return {
      accessToken: await this.tokens.signAccessToken({
        sub: user.id,
        role: user.role,
        sid: result.familyId,
        // El refresco mantiene la sesión; el método original no se guarda en el refresh token.
        amr: ['pwd'],
      }),
      expiresIn: this.tokens.accessTtlSeconds,
      refreshToken: result.refresh.raw,
    };
  }

  async logout(user: AuthUser, ctx: RequestContext): Promise<void> {
    await this.sessions.revokeFamily(user.sid);
    await this.audit.log({
      actorId: user.id,
      action: 'auth.logout',
      entity: 'session',
      entityId: user.sid,
      ip: ctx.ip,
    });
  }

  async logoutAll(user: AuthUser, ctx: RequestContext): Promise<void> {
    const count = await this.sessions.revokeAllForUser(user.id);
    await this.audit.log({
      actorId: user.id,
      action: 'auth.logout_all',
      entity: 'user',
      entityId: user.id,
      ip: ctx.ip,
      meta: { sessions: count },
    });
  }

  private async issue(user: User, amr: AuthUser['amr'], ctx: RequestContext): Promise<TokenPair> {
    const refresh = await this.sessions.start(user.id, ctx);
    return {
      accessToken: await this.tokens.signAccessToken({
        sub: user.id,
        role: user.role,
        sid: refresh.familyId,
        amr,
      }),
      expiresIn: this.tokens.accessTtlSeconds,
      refreshToken: refresh.raw,
    };
  }

  private async enforceEmailRateLimit(email: string): Promise<void> {
    const key = `rl:login-email:${emailHash(email)}`;
    const [[, count]] = (await this.redis.client
      .multi()
      .incr(key)
      .expire(key, LOGIN_EMAIL_WINDOW_S, 'NX')
      .exec()) as [[Error | null, number], [Error | null, number]];
    if (count > LOGIN_EMAIL_LIMIT) {
      throw new ApiException(429, 'RATE_LIMITED', 'Demasiados intentos. Prueba más tarde.');
    }
  }
}
