import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { InjectEnv } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  /** false con MAIL_TRANSPORT=disabled: quien lo use decide qué decirle al usuario. */
  readonly enabled: boolean;
  send(message: MailMessage): Promise<void>;
}

export const MAILER = Symbol('MAILER');

/**
 * Correo saliente con tres modos (8.13): `smtp` envía de verdad (Mailpit en local, el SMTP del
 * dominio en producción), `log` lo escribe en el log (solo desarrollo) y `disabled` no envía.
 * Cambiar de modo es solo configuración: no hace falta tocar código.
 */
@Injectable()
export class ConfigurableMailer implements Mailer {
  private readonly logger = new Logger('Mailer');
  private readonly transporter: Transporter | null;
  private readonly from: string;
  readonly enabled: boolean;

  constructor(@InjectEnv() private readonly env: Env) {
    this.from = env.MAIL_FROM ?? 'rideapp <no-reply@localhost>';
    this.enabled = env.MAIL_TRANSPORT !== 'disabled';
    this.transporter =
      env.MAIL_TRANSPORT === 'smtp'
        ? nodemailer.createTransport({
            host: env.SMTP_HOST,
            port: env.SMTP_PORT,
            secure: env.SMTP_SECURE,
            ...(env.SMTP_USER && { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } }),
            // STARTTLS obligatorio salvo en el SMTP local de pruebas (Mailpit).
            requireTLS: env.NODE_ENV === 'production' && !env.SMTP_SECURE,
            connectionTimeout: 10_000,
            greetingTimeout: 10_000,
            socketTimeout: 20_000,
          })
        : null;
  }

  async send(message: MailMessage): Promise<void> {
    if (this.env.MAIL_TRANSPORT === 'disabled') {
      this.logger.warn({ subject: message.subject }, 'Correo no enviado: MAIL_TRANSPORT=disabled');
      return;
    }
    if (this.env.MAIL_TRANSPORT === 'log') {
      // Solo desarrollo (prohibido en producción por la validación del entorno).
      this.logger.log(`Correo para ${message.to} — ${message.subject}\n${message.text}`);
      return;
    }
    await this.transporter!.sendMail({ from: this.from, ...message });
  }
}
