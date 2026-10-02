import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { AuthUser, RequestContext } from '../../common/auth/auth.decorators.js';
import { InjectEnv } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { SessionRevocationService } from './session-revocation.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export const hashToken = (raw: string) => createHash('sha256').update(raw).digest('hex');

export interface IssuedRefreshToken {
  raw: string;
  familyId: string;
}

export type Amr = AuthUser['amr'];

/** Política de la sesión. Por defecto: 30 días deslizantes (apps). El panel usa inactividad + máximo. */
export interface SessionOptions {
  amr: Amr;
  /** Caduca si no se usa durante este tiempo (cada rotación la renueva). */
  idleSeconds?: number;
  /** Caducidad absoluta desde el login, aunque se siga usando. */
  absoluteSeconds?: number;
}

export type RotateResult =
  | {
      ok: true;
      userId: string;
      familyId: string;
      amr: Amr;
      refresh: IssuedRefreshToken;
      expiresAt: Date;
    }
  | { ok: false; reason: 'INVALID' | 'EXPIRED' | 'REUSED' };

/**
 * Refresh tokens rotativos (8.2, paso 3): 256 bits aleatorios, en BD solo su SHA-256,
 * 30 días de vigencia, uno nuevo en cada uso. Si llega uno ya rotado, se asume robo y se
 * revoca toda la familia (la sesión).
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private readonly ttlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly revocations: SessionRevocationService,
    private readonly audit: AuditService,
    @InjectEnv() env: Env,
  ) {
    this.ttlMs = env.REFRESH_TOKEN_TTL_DAYS * DAY_MS;
  }

  /** Abre una sesión nueva (familia nueva). */
  async start(
    userId: string,
    ctx: RequestContext,
    options: SessionOptions,
  ): Promise<IssuedRefreshToken & { expiresAt: Date }> {
    const raw = this.newToken();
    const familyId = randomUUID();
    const absoluteExpiresAt = options.absoluteSeconds
      ? new Date(Date.now() + options.absoluteSeconds * 1000)
      : null;
    const expiresAt = this.nextExpiry(options.idleSeconds ?? null, absoluteExpiresAt);
    await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: hashToken(raw),
        userAgent: ctx.userAgent,
        ip: ctx.ip,
        expiresAt,
        amr: options.amr,
        idleSeconds: options.idleSeconds ?? null,
        absoluteExpiresAt,
      },
    });
    return { raw, familyId, expiresAt };
  }

  /** Inactividad (si aplica) sin pasar del máximo absoluto; si no, los 30 días por defecto. */
  private nextExpiry(idleSeconds: number | null, absolute: Date | null): Date {
    const candidate = idleSeconds ? Date.now() + idleSeconds * 1000 : Date.now() + this.ttlMs;
    return new Date(absolute ? Math.min(candidate, absolute.getTime()) : candidate);
  }

  async rotate(raw: string, ctx: RequestContext): Promise<RotateResult> {
    const current = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(raw) },
    });
    if (!current) return { ok: false, reason: 'INVALID' };

    if (current.revokedAt) {
      await this.revokeFamily(current.familyId);
      this.logger.warn(
        { userId: current.userId, familyId: current.familyId },
        'Reutilización de refresh token',
      );
      await this.audit.log({
        actorId: current.userId,
        action: 'auth.refresh_reuse_detected',
        entity: 'session',
        entityId: current.familyId,
        ip: ctx.ip,
      });
      return { ok: false, reason: 'REUSED' };
    }
    if (current.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'EXPIRED' };

    const next = this.newToken();
    const nextId = randomUUID();
    const expiresAt = this.nextExpiry(current.idleSeconds, current.absoluteExpiresAt);
    const rotated = await this.prisma.$transaction(async (tx) => {
      // Condición sobre revoked_at: si dos peticiones rotan el mismo token, solo una gana.
      const { count } = await tx.refreshToken.updateMany({
        where: { id: current.id, revokedAt: null },
        data: { revokedAt: new Date(), replacedBy: nextId },
      });
      if (count === 0) return false;
      await tx.refreshToken.create({
        data: {
          id: nextId,
          userId: current.userId,
          familyId: current.familyId,
          tokenHash: hashToken(next),
          userAgent: ctx.userAgent,
          ip: ctx.ip,
          expiresAt,
          amr: current.amr,
          idleSeconds: current.idleSeconds,
          absoluteExpiresAt: current.absoluteExpiresAt,
        },
      });
      return true;
    });

    if (!rotated) {
      await this.revokeFamily(current.familyId);
      return { ok: false, reason: 'REUSED' };
    }
    return {
      ok: true,
      userId: current.userId,
      familyId: current.familyId,
      amr: current.amr as Amr,
      refresh: { raw: next, familyId: current.familyId },
      expiresAt,
    };
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.revocations.revoke(familyId);
  }

  /** "Cerrar todas las sesiones": revoca todas las familias del usuario. */
  async revokeAllForUser(userId: string): Promise<number> {
    const families = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null },
      select: { familyId: true },
      distinct: ['familyId'],
    });
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.revocations.revoke(...families.map((f) => f.familyId));
    return families.length;
  }

  private newToken(): string {
    return randomBytes(32).toString('base64url');
  }
}
