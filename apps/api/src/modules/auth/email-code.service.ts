import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ApiException } from '../../common/errors/api.exception.js';
import { InjectEnv } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import type { EmailCodePurpose } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

const MAX_ATTEMPTS = 5;
/** Vigencias de 8.2 (paso 6) y 14.2: verificación 24 h, recuperación 30 min. */
const TTL_MS: Record<EmailCodePurpose, number> = {
  VERIFY_EMAIL: 24 * 60 * 60 * 1000,
  RESET_PASSWORD: 30 * 60 * 1000,
};
const MIN_INTERVAL_MS = 60 * 1000;
const MAX_PER_HOUR = 5;

/**
 * Códigos de 6 dígitos de un solo uso. Se guarda su HMAC con una clave del servidor: una copia de
 * la BD no basta para recuperarlos (1 millón de combinaciones sería trivial con un hash simple).
 */
@Injectable()
export class EmailCodeService {
  private readonly key: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    @InjectEnv() env: Env,
  ) {
    // Clave derivada, distinta de la que cifra columnas aunque parta del mismo secreto.
    this.key = createHmac('sha256', Buffer.from(env.FIELD_ENCRYPTION_KEY, 'base64'))
      .update('email-codes/v1')
      .digest();
  }

  private hmac(userId: string, purpose: EmailCodePurpose, code: string): string {
    return createHmac('sha256', this.key).update(`${userId}:${purpose}:${code}`).digest('hex');
  }

  /**
   * Genera un código nuevo e invalida los anteriores del mismo tipo.
   * Límite: uno por minuto y cinco por hora por usuario (evita usar el sistema para enviar spam).
   */
  async issue(userId: string, purpose: EmailCodePurpose): Promise<string> {
    const recent = await this.prisma.emailCode.findMany({
      where: { userId, purpose, createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const last = recent[0];
    if (
      recent.length >= MAX_PER_HOUR ||
      (last && Date.now() - last.createdAt.getTime() < MIN_INTERVAL_MS)
    ) {
      throw new ApiException(429, 'RATE_LIMITED', 'Espera un momento antes de pedir otro código.');
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.prisma.$transaction([
      this.prisma.emailCode.updateMany({
        where: { userId, purpose, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.emailCode.create({
        data: {
          userId,
          purpose,
          codeHmac: this.hmac(userId, purpose, code),
          expiresAt: new Date(Date.now() + TTL_MS[purpose]),
        },
      }),
    ]);
    return code;
  }

  /** true si el código es el vigente; consume un intento siempre y lo marca usado si acierta. */
  async consume(userId: string, purpose: EmailCodePurpose, code: string): Promise<boolean> {
    const current = await this.prisma.emailCode.findFirst({
      where: { userId, purpose, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!current) return false;

    // Contar el intento antes de comparar, con condición atómica: nada de intentos ilimitados en paralelo.
    const { count } = await this.prisma.emailCode.updateMany({
      where: { id: current.id, usedAt: null, attempts: { lt: MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (count === 0) return false;

    const expected = Buffer.from(current.codeHmac, 'hex');
    const given = Buffer.from(this.hmac(userId, purpose, code), 'hex');
    if (!timingSafeEqual(expected, given)) return false;

    const used = await this.prisma.emailCode.updateMany({
      where: { id: current.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    return used.count === 1;
  }
}
