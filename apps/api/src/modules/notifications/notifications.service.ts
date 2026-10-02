import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  PUSH_CHANNEL_TRIPS,
  type PushData,
  type PushPlatform,
  type RegisterPushTokenRequest,
} from '@rideapp/contracts';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { QueueService } from '../../infra/queue/queue.service.js';
import { PUSH_SENDER, type PushSender } from './push-sender.js';

/** Cola de avisos: push y correos transaccionales (recibos). */
export const NOTIFICATIONS_QUEUE = 'notifications';

/**
 * Plantillas de push (8.13, paso 2): textos genéricos, sin direcciones ni teléfonos. La app
 * consulta el detalle al API al abrirla.
 */
const TEMPLATES = {
  'trip.offer': {
    title: 'Nueva solicitud de viaje',
    body: 'Tienes una solicitud cerca. Ábrela antes de que caduque.',
  },
  'trip.assigned': { title: 'Tu conductor va en camino', body: 'Abre la app para seguirlo.' },
  'trip.arrived': {
    title: 'Tu conductor llegó',
    body: 'Te espera en el punto de recogida. Dale tu PIN para empezar.',
  },
  'trip.no_drivers': {
    title: 'No encontramos conductores',
    body: 'Inténtalo de nuevo en unos minutos.',
  },
  'trip.cancelled_by_passenger': {
    title: 'El pasajero canceló el viaje',
    body: 'Ya puedes recibir otras solicitudes.',
  },
  'trip.cancelled_by_driver': {
    title: 'Tu conductor canceló el viaje',
    body: 'Abre la app para pedir otro.',
  },
  'driver.approved': {
    title: 'Tu cuenta de conductor está aprobada',
    body: 'Ya puedes ponerte en línea y recibir viajes.',
  },
  'driver.rejected': {
    title: 'Tu solicitud de conductor necesita cambios',
    body: 'Abre la app para ver qué corregir.',
  },
} as const satisfies Record<string, { title: string; body: string }>;

export type PushTemplate = keyof typeof TEMPLATES;

interface PushJob {
  userId: string;
  template: PushTemplate;
  data: PushData;
  ttlSeconds?: number;
}

/** Tokens por usuario: varios teléfonos son posibles, pero no cientos. */
const MAX_TOKENS_PER_USER = 5;

/**
 * Notificaciones push (8.13). `push` encola y vuelve enseguida: un fallo de Expo nunca rompe la
 * acción que lo provocó. El worker envía a todos los tokens del usuario y borra los que Expo
 * reporta como `DeviceNotRegistered`.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    @Inject(PUSH_SENDER) private readonly sender: PushSender,
  ) {}

  onModuleInit(): void {
    this.queues.handle(NOTIFICATIONS_QUEUE, 'push', (job) => this.deliver(job.data as PushJob), 4);
  }

  async push(
    userId: string,
    template: PushTemplate,
    data: PushData,
    opts: { ttlSeconds?: number } = {},
  ): Promise<void> {
    if (!this.sender.enabled) return;
    try {
      await this.queues.add(
        NOTIFICATIONS_QUEUE,
        'push',
        { userId, template, data, ttlSeconds: opts.ttlSeconds } satisfies PushJob,
        { attempts: 3, backoff: { type: 'exponential', delay: 2_000 } },
      );
    } catch (err) {
      this.logger.warn({ err, template }, 'No se pudo encolar el push');
    }
  }

  /** Registra (o reasigna) un token: si otro usuario lo tenía, ese teléfono ahora es de este. */
  async register(userId: string, { token, platform }: RegisterPushTokenRequest): Promise<void> {
    await this.prisma.pushToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform, lastSeenAt: new Date() },
    });
    const extra = await this.prisma.pushToken.findMany({
      where: { userId },
      orderBy: { lastSeenAt: 'desc' },
      skip: MAX_TOKENS_PER_USER,
      select: { id: true },
    });
    if (extra.length) {
      await this.prisma.pushToken.deleteMany({ where: { id: { in: extra.map((t) => t.id) } } });
    }
  }

  /** Solo borra el token si es del usuario (no se puede desregistrar el teléfono de otro). */
  async unregister(userId: string, token: string): Promise<void> {
    await this.prisma.pushToken.deleteMany({ where: { userId, token } });
  }

  /** Al cerrar todas las sesiones o suspender la cuenta: ningún teléfono sigue recibiendo avisos. */
  async forgetUser(userId: string): Promise<void> {
    await this.prisma.pushToken.deleteMany({ where: { userId } });
  }

  async deliver(job: PushJob): Promise<number> {
    const tokens = await this.prisma.pushToken.findMany({
      where: { userId: job.userId },
      select: { token: true, platform: true },
    });
    if (tokens.length === 0) return 0;
    const template = TEMPLATES[job.template];
    const tickets = await this.sender.send(
      tokens.map(({ token, platform }) => ({
        to: token,
        title: template.title,
        body: template.body,
        data: job.data,
        priority: 'high',
        ...(job.ttlSeconds && { ttl: job.ttlSeconds }),
        ...((platform as PushPlatform) === 'android' && { channelId: PUSH_CHANNEL_TRIPS }),
      })),
    );
    const stale = tokens.filter((_, i) => {
      const ticket = tickets[i];
      return ticket && !ticket.ok && ticket.unregistered;
    });
    if (stale.length) {
      await this.prisma.pushToken.deleteMany({
        where: { token: { in: stale.map((t) => t.token) } },
      });
    }
    return tickets.filter((t) => t.ok).length;
  }
}
