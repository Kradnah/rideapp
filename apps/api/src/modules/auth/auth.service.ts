import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  CURRENT_POLICY_VERSION,
  type GoogleLoginRequest,
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
import { AccountEmailService } from './account-email.service.js';
import { GOOGLE_VERIFIER, type GoogleTokenVerifier } from './google-verifier.js';
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
    @Inject(GOOGLE_VERIFIER) private readonly google: GoogleTokenVerifier,
    private readonly accountEmail: AccountEmailService,
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
    this.accountEmail.sendVerificationInBackground(user);
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

  /**
   * Inicio de sesión con Google (8.2, flujo). El usuario se identifica por `sub`; el email solo
   * sirve para vincular una cuenta existente cuyo email ya esté verificado.
   */
  async loginWithGoogle(body: GoogleLoginRequest, ctx: RequestContext): Promise<TokenPair> {
    if (!this.google.enabled) {
      throw new ApiException(404, 'NOT_FOUND', 'El inicio de sesión con Google no está disponible');
    }
    const identity = await this.google.verify(body.idToken);
    if (!identity)
      throw new ApiException(401, 'UNAUTHORIZED', 'No se pudo verificar la cuenta de Google');
    if (!identity.emailVerified) {
      throw new ApiException(
        401,
        'UNAUTHORIZED',
        'La cuenta de Google no tiene el email verificado',
      );
    }

    const linked = await this.prisma.authIdentity.findUnique({
      where: { provider_providerSubject: { provider: 'GOOGLE', providerSubject: identity.sub } },
      include: { user: true },
    });

    let user: User;
    let event: 'login' | 'linked' | 'register';
    if (linked && !linked.user.deletedAt) {
      user = linked.user;
      event = 'login';
    } else {
      const byEmail = await this.users.findByEmail(identity.email);
      if (byEmail) {
        // Vincular solo si el email de la cuenta existente ya está verificado: si no, alguien pudo
        // registrarse con un email ajeno y quedarse con la cuenta del dueño real (toma de cuenta).
        if (!byEmail.emailVerified) {
          throw new ApiException(
            409,
            'CONFLICT',
            'Ya existe una cuenta con este email. Inicia sesión con tu contraseña.',
          );
        }
        await this.prisma.authIdentity.create({
          data: { userId: byEmail.id, provider: 'GOOGLE', providerSubject: identity.sub },
        });
        user = byEmail;
        event = 'linked';
      } else {
        if (body.consent?.policyVersion !== CURRENT_POLICY_VERSION) {
          throw new ApiException(
            409,
            'CONSENT_REQUIRED',
            'Acepta la política para crear tu cuenta',
          );
        }
        const role = body.role ?? 'PASSENGER';
        user = await this.prisma.user.create({
          data: {
            email: identity.email,
            emailVerified: true,
            fullName: identity.name ?? identity.email.split('@')[0] ?? 'Usuario',
            role,
            identities: { create: { provider: 'GOOGLE', providerSubject: identity.sub } },
            consents: {
              create: {
                policyVersion: body.consent.policyVersion,
                ip: ctx.ip,
                channel: role === 'DRIVER' ? 'driver' : 'passenger',
              },
            },
          },
        });
        event = 'register';
      }
    }

    if (user.role === 'ADMIN') throw invalidCredentials();
    if (user.status !== 'ACTIVE') {
      throw new ApiException(403, 'ACCOUNT_DISABLED', 'Tu cuenta no está activa');
    }

    // Anti-replay (8.2, paso 3): cada idToken abre como máximo una sesión. Se marca aquí, al
    // emitir, para que la app pueda reintentar con el mismo token tras aceptar el consentimiento.
    const ttl = Math.max(identity.exp - Math.floor(Date.now() / 1000), 1);
    const fresh = await this.redis.client.set(
      `google:idtoken:${createHash('sha256').update(body.idToken).digest('hex')}`,
      '1',
      'EX',
      ttl,
      'NX',
    );
    if (fresh !== 'OK') throw new ApiException(401, 'UNAUTHORIZED', 'Token de Google ya utilizado');

    await this.audit.log({
      actorId: user.id,
      action:
        event === 'register'
          ? 'auth.register'
          : event === 'linked'
            ? 'auth.google_linked'
            : 'auth.login',
      entity: 'user',
      entityId: user.id,
      ip: ctx.ip,
      meta: { method: 'google' },
    });
    if (event === 'linked') this.accountEmail.notifyGoogleLinked(user);
    return this.issue(user, ['google'], ctx);
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
        // Se conserva cómo se inició la sesión (pwd, google…), guardado en el refresh token.
        amr: result.amr,
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
    const refresh = await this.sessions.start(user.id, ctx, { amr });
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
