import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ForgotPasswordRequest, ResetPasswordRequest } from '@rideapp/contracts';
import type { AuthUser, RequestContext } from '../../common/auth/auth.decorators.js';
import { ApiException } from '../../common/errors/api.exception.js';
import type { User } from '../../generated/prisma/client.js';
import {
  googleLinkedEmail,
  passwordChangedEmail,
  passwordResetEmail,
  verificationEmail,
} from '../../infra/mail/mail-templates.js';
import { MAILER, type Mailer } from '../../infra/mail/mailer.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { RedisService } from '../../infra/redis/redis.service.js';
import { AuditService } from '../audit/audit.service.js';
import { UsersService } from '../users/users.service.js';
import { EmailCodeService } from './email-code.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';

const FORGOT_EMAIL_LIMIT = 5;
const FORGOT_WINDOW_S = 60 * 60;
const emailHash = (email: string) => createHash('sha256').update(email).digest('hex').slice(0, 32);
const invalidCode = () => new ApiException(400, 'INVALID_CODE', 'Código incorrecto o caducado');

/** Verificación de email, recuperación de contraseña y avisos de seguridad por correo (8.2, 14.2). */
@Injectable()
export class AccountEmailService {
  private readonly logger = new Logger(AccountEmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly users: UsersService,
    private readonly codes: EmailCodeService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  /** Tras el registro con contraseña: envía el código sin bloquear la respuesta. */
  sendVerificationInBackground(user: User): void {
    if (!this.mailer.enabled || !user.email || user.emailVerified) return;
    void this.codes
      .issue(user.id, 'VERIFY_EMAIL')
      .then((code) => this.mailer.send(verificationEmail(user.email!, user.fullName, code)))
      .catch((err: unknown) => this.logger.error({ err }, 'No se pudo enviar la verificación'));
  }

  async requestVerification(authUser: AuthUser): Promise<void> {
    const user = await this.users.findActiveById(authUser.id);
    if (!user?.email || user.emailVerified) return;
    if (!this.mailer.enabled) {
      throw new ApiException(
        503,
        'SERVICE_UNAVAILABLE',
        'El envío de correos aún no está disponible.',
      );
    }
    const code = await this.codes.issue(user.id, 'VERIFY_EMAIL');
    await this.deliver(verificationEmail(user.email, user.fullName, code));
  }

  async verifyEmail(authUser: AuthUser, code: string, ctx: RequestContext): Promise<void> {
    if (!(await this.codes.consume(authUser.id, 'VERIFY_EMAIL', code))) throw invalidCode();
    await this.prisma.user.update({ where: { id: authUser.id }, data: { emailVerified: true } });
    await this.audit.log({
      actorId: authUser.id,
      action: 'auth.email_verified',
      entity: 'user',
      entityId: authUser.id,
      ip: ctx.ip,
    });
  }

  /**
   * Siempre la misma respuesta, exista o no el email (14.2). Los admins no recuperan su contraseña
   * por correo: se restablece con la CLI.
   */
  async forgotPassword(body: ForgotPasswordRequest, ctx: RequestContext): Promise<void> {
    const key = `rl:forgot-email:${emailHash(body.email)}`;
    const count = await this.redis.client.incr(key);
    if (count === 1) await this.redis.client.expire(key, FORGOT_WINDOW_S);
    if (count > FORGOT_EMAIL_LIMIT) return;

    const user = await this.users.findByEmail(body.email);
    if (!user?.email || user.role === 'ADMIN' || user.status !== 'ACTIVE') return;
    if (!this.mailer.enabled) {
      this.logger.warn('Recuperación de contraseña pedida con MAIL_TRANSPORT=disabled');
      return;
    }
    try {
      const code = await this.codes.issue(user.id, 'RESET_PASSWORD');
      await this.mailer.send(passwordResetEmail(user.email, user.fullName, code));
      await this.audit.log({
        actorId: user.id,
        action: 'auth.password_reset_requested',
        entity: 'user',
        entityId: user.id,
        ip: ctx.ip,
      });
    } catch (err) {
      // Ni el límite de envíos ni un fallo del SMTP se revelan: la respuesta es siempre la misma.
      if (!(err instanceof ApiException))
        this.logger.error({ err }, 'Fallo al enviar la recuperación');
    }
  }

  async resetPassword(body: ResetPasswordRequest, ctx: RequestContext): Promise<void> {
    const user = await this.users.findByEmail(body.email);
    if (!user || user.role === 'ADMIN' || user.status !== 'ACTIVE') throw invalidCode();
    if (!(await this.codes.consume(user.id, 'RESET_PASSWORD', body.code))) throw invalidCode();

    const problem = this.passwords.check(body.password, body.email);
    if (problem) {
      throw new ApiException(400, 'WEAK_PASSWORD', 'Elige una contraseña menos predecible', {
        reason: problem,
      });
    }
    await this.prisma.user.update({
      where: { id: user.id },
      // Quien recibió el código en su correo demostró que el email es suyo.
      data: { passwordHash: await this.passwords.hash(body.password), emailVerified: true },
    });
    const sessions = await this.sessions.revokeAllForUser(user.id);
    await this.audit.log({
      actorId: user.id,
      action: 'auth.password_reset',
      entity: 'user',
      entityId: user.id,
      ip: ctx.ip,
      meta: { sessionsRevoked: sessions },
    });
    void this.deliver(passwordChangedEmail(user.email!, user.fullName)).catch(() => undefined);
  }

  /** Aviso "se vinculó Google a tu cuenta" (8.2). Nunca bloquea el login. */
  notifyGoogleLinked(user: User): void {
    if (!this.mailer.enabled || !user.email) return;
    void this.mailer
      .send(googleLinkedEmail(user.email, user.fullName))
      .catch((err: unknown) => this.logger.error({ err }, 'No se pudo enviar el aviso de Google'));
  }

  private async deliver(message: Parameters<Mailer['send']>[0]): Promise<void> {
    try {
      await this.mailer.send(message);
    } catch (err) {
      this.logger.error({ err }, 'Fallo del SMTP');
      throw new ApiException(
        503,
        'SERVICE_UNAVAILABLE',
        'No se pudo enviar el correo. Inténtalo más tarde.',
      );
    }
  }
}
