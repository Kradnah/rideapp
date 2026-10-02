import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { AdminLoginChallenge, AdminTotpRequest, LoginRequest } from '@rideapp/contracts';
import type { RequestContext } from '../../common/auth/auth.decorators.js';
import { FieldCrypto } from '../../common/crypto/field-crypto.js';
import { ApiException } from '../../common/errors/api.exception.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { RedisService } from '../../infra/redis/redis.service.js';
import { buildTotp, validateTotp } from '../admin/admin-provisioning.js';
import { AuditService } from '../audit/audit.service.js';
import { UsersService } from '../users/users.service.js';
import { PasswordService } from './password.service.js';
import { SessionService, hashToken } from './session.service.js';
import { TokenService } from './token.service.js';

const CHALLENGE_TTL_S = 5 * 60;
const MAX_TOTP_ATTEMPTS = 5;
/** Sesión del panel: 30 min de inactividad y 8 h como máximo (11.2). */
export const ADMIN_IDLE_S = 30 * 60;
export const ADMIN_ABSOLUTE_S = 8 * 60 * 60;
const LOGIN_EMAIL_LIMIT = 10;
const LOGIN_EMAIL_WINDOW_S = 15 * 60;

const challengeKey = (id: string) => `admin:challenge:${id}`;
const emailHash = (email: string) => createHash('sha256').update(email).digest('hex').slice(0, 32);
const invalid = () => new ApiException(401, 'INVALID_CREDENTIALS', 'Credenciales inválidas');

export interface AdminSessionResult {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

/** Login del panel en dos pasos: contraseña → reto → código TOTP (8.2, 8.14, 11.1). */
@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly tokens: TokenService,
    private readonly crypto: FieldCrypto,
    private readonly audit: AuditService,
  ) {}

  async login(body: LoginRequest, ctx: RequestContext): Promise<AdminLoginChallenge> {
    await this.enforceEmailRateLimit(body.email);
    const user = await this.users.findByEmail(body.email);
    const ok = await this.passwords.verify(user?.passwordHash, body.password);
    const hasTotp = user ? await this.prisma.adminTotp.count({ where: { userId: user.id } }) : 0;
    if (!user || !ok || user.role !== 'ADMIN' || user.status !== 'ACTIVE' || !hasTotp) {
      await this.audit.log({
        actorId: user?.id ?? null,
        action: 'admin.login_failed',
        entity: 'user',
        entityId: user?.id ?? null,
        ip: ctx.ip,
        meta: { step: 'password', emailHash: emailHash(body.email) },
      });
      throw invalid();
    }
    const challengeId = randomBytes(24).toString('base64url');
    await this.redis.client
      .multi()
      .hset(challengeKey(challengeId), { userId: user.id, attempts: 0 })
      .expire(challengeKey(challengeId), CHALLENGE_TTL_S)
      .exec();
    return { challengeId, expiresIn: CHALLENGE_TTL_S };
  }

  async verifyTotp(body: AdminTotpRequest, ctx: RequestContext): Promise<AdminSessionResult> {
    const key = challengeKey(body.challengeId);
    const userId = await this.redis.client.hget(key, 'userId');
    if (!userId) {
      throw new ApiException(
        401,
        'UNAUTHORIZED',
        'El acceso caducó. Vuelve a introducir tu contraseña.',
      );
    }
    const attempts = await this.redis.client.hincrby(key, 'attempts', 1);
    if (attempts > MAX_TOTP_ATTEMPTS) {
      await this.redis.client.del(key);
      throw new ApiException(429, 'RATE_LIMITED', 'Demasiados intentos. Vuelve a empezar.');
    }

    const record = await this.prisma.adminTotp.findUnique({
      where: { userId },
      include: { user: true },
    });
    if (!record || record.user.role !== 'ADMIN' || record.user.status !== 'ACTIVE') throw invalid();

    const totp = buildTotp(this.crypto.decrypt(record.secretEnc), record.user.email ?? '');
    const step = validateTotp(totp, body.code);
    // Un código ya usado no vale aunque siga dentro de su ventana: condición sobre last_used_step.
    const accepted =
      step !== null &&
      (
        await this.prisma.adminTotp.updateMany({
          where: { userId, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: step } }] },
          data: { lastUsedStep: step },
        })
      ).count === 1;
    if (!accepted) {
      await this.audit.log({
        actorId: userId,
        action: 'admin.login_failed',
        entity: 'user',
        entityId: userId,
        ip: ctx.ip,
        meta: { step: 'totp' },
      });
      throw new ApiException(401, 'INVALID_CREDENTIALS', 'Código incorrecto');
    }

    await this.redis.client.del(key);
    const refresh = await this.sessions.start(userId, ctx, {
      amr: ['pwd', 'totp'],
      idleSeconds: ADMIN_IDLE_S,
      absoluteSeconds: ADMIN_ABSOLUTE_S,
    });
    await this.audit.log({
      actorId: userId,
      action: 'admin.login',
      entity: 'user',
      entityId: userId,
      ip: ctx.ip,
    });
    return {
      accessToken: await this.tokens.signAccessToken({
        sub: userId,
        role: 'ADMIN',
        sid: refresh.familyId,
        amr: ['pwd', 'totp'],
      }),
      expiresIn: this.tokens.accessTtlSeconds,
      refreshToken: refresh.raw,
      refreshExpiresAt: refresh.expiresAt,
    };
  }

  async refresh(raw: string, ctx: RequestContext): Promise<AdminSessionResult> {
    const result = await this.sessions.rotate(raw, ctx);
    if (!result.ok) throw new ApiException(401, 'UNAUTHORIZED', 'Sesión caducada');
    const user = await this.users.findActiveById(result.userId);
    if (
      !user ||
      user.role !== 'ADMIN' ||
      user.status !== 'ACTIVE' ||
      !result.amr.includes('totp')
    ) {
      await this.sessions.revokeFamily(result.familyId);
      throw new ApiException(401, 'UNAUTHORIZED', 'Sesión caducada');
    }
    return {
      accessToken: await this.tokens.signAccessToken({
        sub: user.id,
        role: 'ADMIN',
        sid: result.familyId,
        amr: result.amr,
      }),
      expiresIn: this.tokens.accessTtlSeconds,
      refreshToken: result.refresh.raw,
      refreshExpiresAt: result.expiresAt,
    };
  }

  async logout(raw: string | undefined, ctx: RequestContext): Promise<void> {
    if (!raw) return;
    const token = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(raw) },
    });
    if (!token) return;
    await this.sessions.revokeFamily(token.familyId);
    await this.audit.log({
      actorId: token.userId,
      action: 'admin.logout',
      entity: 'session',
      entityId: token.familyId,
      ip: ctx.ip,
    });
  }

  private async enforceEmailRateLimit(email: string): Promise<void> {
    const key = `rl:admin-login-email:${emailHash(email)}`;
    const count = await this.redis.client.incr(key);
    if (count === 1) await this.redis.client.expire(key, LOGIN_EMAIL_WINDOW_S);
    if (count > LOGIN_EMAIL_LIMIT) {
      throw new ApiException(429, 'RATE_LIMITED', 'Demasiados intentos. Prueba más tarde.');
    }
  }
}
