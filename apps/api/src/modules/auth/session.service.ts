import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { RequestContext } from '../../common/auth/auth.decorators.js';
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

export type RotateResult =
  | { ok: true; userId: string; familyId: string; refresh: IssuedRefreshToken }
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
  async start(userId: string, ctx: RequestContext): Promise<IssuedRefreshToken> {
    return this.create(userId, randomUUID(), ctx);
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
          expiresAt: new Date(Date.now() + this.ttlMs),
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
      refresh: { raw: next, familyId: current.familyId },
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

  private async create(userId: string, familyId: string, ctx: RequestContext) {
    const raw = this.newToken();
    await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: hashToken(raw),
        userAgent: ctx.userAgent,
        ip: ctx.ip,
        expiresAt: new Date(Date.now() + this.ttlMs),
      },
    });
    return { raw, familyId };
  }

  private newToken(): string {
    return randomBytes(32).toString('base64url');
  }
}
