import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { AdminOverview, PaymentMethod } from '@rideapp/contracts';
import { ApiException } from '../../common/errors/api.exception.js';
import type { Payment, Trip } from '../../generated/prisma/client.js';
import { receiptEmail } from '../../infra/mail/mail-templates.js';
import { MAILER, type Mailer } from '../../infra/mail/mailer.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { QueueService } from '../../infra/queue/queue.service.js';
import { AuditService } from '../audit/audit.service.js';
import { colombiaDay } from '../geo/geo.service.js';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.service.js';
import { CashProvider, FakeCardProvider, type PaymentProvider } from './payment-providers.js';

/**
 * Pagos de la demo (8.11): uno por viaje, creado al completarlo. La tarjeta demo se cobra al
 * instante; el efectivo queda pendiente hasta que el conductor confirma que lo recibió. Cuando el
 * pago queda cobrado se envía el recibo por correo al pasajero.
 */
@Injectable()
export class PaymentsService implements OnModuleInit {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly providers: Record<PaymentMethod, PaymentProvider> = {
    CASH: new CashProvider(),
    FAKE_CARD: new FakeCardProvider(),
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly audit: AuditService,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  onModuleInit(): void {
    this.queues.handle(NOTIFICATIONS_QUEUE, 'receipt-email', (job) =>
      this.sendReceipt((job.data as { tripId: string }).tripId),
    );
  }

  /**
   * Al completar el viaje. Idempotente: si el pago ya existe (reintento), lo devuelve tal cual.
   * El importe es el final del viaje, nunca uno que mande el cliente.
   */
  async settle(trip: Trip): Promise<Payment> {
    const existing = await this.prisma.payment.findUnique({ where: { tripId: trip.id } });
    if (existing) return existing;

    const provider = this.providers[trip.paymentMethod];
    const input = {
      tripId: trip.id,
      amountCents: trip.finalAmountCents ?? trip.amountCents,
      currency: trip.currency,
    };
    let result = await provider.authorize(input);
    if (result.status === 'AUTHORIZED') {
      result = await provider.capture({ ...input, providerRef: result.providerRef });
    }
    const captured = result.status === 'CAPTURED';
    const payment = await this.prisma.payment.upsert({
      where: { tripId: trip.id },
      create: {
        tripId: trip.id,
        provider: provider.method,
        providerRef: result.providerRef,
        amountCents: input.amountCents,
        currency: input.currency,
        status: result.status,
        capturedAt: captured ? new Date() : null,
      },
      update: {},
    });
    await this.audit.log({
      actorId: null,
      action: 'payment.created',
      entity: 'payment',
      entityId: payment.id,
      meta: { tripId: trip.id, provider: provider.method, status: payment.status },
    });
    if (captured) await this.queueReceipt(trip.id);
    return payment;
  }

  /**
   * "Confirmar cobro" (10.3, paso 4): el conductor asignado recibió el efectivo. Repetirlo no
   * hace nada (la app puede reintentar con mala conexión).
   */
  async confirmCash(driverId: string, tripId: string, ip: string | null): Promise<void> {
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip || trip.driverId !== driverId) {
      throw new ApiException(404, 'NOT_FOUND', 'Viaje no encontrado');
    }
    if (trip.status !== 'COMPLETED' || trip.paymentMethod !== 'CASH') {
      throw new ApiException(
        409,
        'CONFLICT',
        'Este viaje no tiene un cobro en efectivo pendiente.',
      );
    }
    // Red de seguridad: si el pago no se creó al completar (caída a mitad), se crea ahora.
    await this.settle(trip);
    const { count } = await this.prisma.payment.updateMany({
      where: { tripId, provider: 'CASH', status: 'PENDING' },
      data: { status: 'CAPTURED', capturedAt: new Date(), confirmedBy: driverId },
    });
    if (count === 0) return;
    await this.audit.log({
      actorId: driverId,
      action: 'payment.cash_confirmed',
      entity: 'trip',
      entityId: tripId,
      ip,
    });
    await this.queueReceipt(tripId);
  }

  /** Para el dashboard del panel. */
  async summary(now = Date.now()): Promise<AdminOverview['payments']> {
    const startOfDay = new Date(`${colombiaDay(now)}T05:00:00.000Z`);
    const [pendingCash, today] = await Promise.all([
      this.prisma.payment.count({ where: { provider: 'CASH', status: 'PENDING' } }),
      this.prisma.payment.aggregate({
        where: { status: 'CAPTURED', capturedAt: { gte: startOfDay } },
        _sum: { amountCents: true },
      }),
    ]);
    return {
      pendingCash,
      capturedToday: { amountCents: today._sum.amountCents ?? 0, currency: 'COP' },
    };
  }

  private async queueReceipt(tripId: string): Promise<void> {
    if (!this.mailer.enabled) return;
    try {
      await this.queues.add(
        NOTIFICATIONS_QUEUE,
        'receipt-email',
        { tripId },
        // Un recibo por viaje aunque se encole dos veces.
        {
          jobId: `receipt-${tripId}`,
          attempts: 5,
          backoff: { type: 'exponential', delay: 30_000 },
        },
      );
    } catch (err) {
      this.logger.warn({ err, tripId }, 'No se pudo encolar el recibo');
    }
  }

  async sendReceipt(tripId: string): Promise<boolean> {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        passenger: { select: { email: true, fullName: true, deletedAt: true } },
        driver: { select: { user: { select: { fullName: true } } } },
        payment: true,
      },
    });
    const to = trip?.passenger.email;
    if (!trip?.completedAt || !trip.payment || !to || trip.passenger.deletedAt) return false;
    await this.mailer.send(
      receiptEmail(to, trip.passenger.fullName, {
        tripId: trip.id,
        amountCents: trip.payment.amountCents,
        currency: trip.payment.currency,
        paymentMethod: trip.payment.provider,
        originAddress: trip.originAddress,
        destinationAddress: trip.destinationAddress,
        distanceMeters: trip.distanceM,
        completedAt: trip.completedAt,
        driverName: trip.driver?.user.fullName ?? null,
      }),
    );
    return true;
  }
}
