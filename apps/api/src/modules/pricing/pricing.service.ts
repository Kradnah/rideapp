import { Injectable } from '@nestjs/common';
import {
  type AdminFareRules,
  computeFare,
  type CreateFareRuleRequest,
  DEFAULT_CURRENCY,
  haversineMeters,
  type QuoteRequest,
  type QuoteResponse,
  VehicleCategory,
} from '@rideapp/contracts';
import { ApiException } from '../../common/errors/api.exception.js';
import type { FareRule } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { GeoService } from '../geo/geo.service.js';

/** Una cotización vale 5 minutos (8.7, paso 1). */
export const QUOTE_TTL_MS = 5 * 60_000;
/** Más cerca que esto no tiene sentido pedir un viaje. */
const MIN_TRIP_METERS = 100;

/**
 * Cotización (8.7): ruta con el proveedor de mapas → tarifa vigente de cada categoría → una fila
 * en `fare_quotes` por categoría. El precio lo calcula siempre el servidor.
 */
@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geo: GeoService,
    private readonly audit: AuditService,
  ) {}

  async quote(passengerId: string, req: QuoteRequest, now = new Date()): Promise<QuoteResponse> {
    // Fuera de zona no se gasta cuota de Google (8.6, paso 6).
    await this.geo.assertInServiceArea(req.origin, req.destination);
    if (haversineMeters(req.origin, req.destination) < MIN_TRIP_METERS) {
      throw new ApiException(422, 'VALIDATION_FAILED', 'El destino está demasiado cerca.');
    }

    const rules = await this.currentRules(now);
    if (rules.length === 0) {
      throw new ApiException(503, 'SERVICE_UNAVAILABLE', 'No hay tarifas configuradas.');
    }
    const route = await this.geo.route(passengerId, req.origin, req.destination);
    const expiresAt = new Date(now.getTime() + QUOTE_TTL_MS);

    const quotes = await this.prisma.fareQuote.createManyAndReturn({
      data: rules.map((rule) => ({
        passengerId,
        fareRuleId: rule.id,
        category: rule.category,
        originLat: req.origin.lat,
        originLng: req.origin.lng,
        destinationLat: req.destination.lat,
        destinationLng: req.destination.lng,
        originAddress: req.originAddress || null,
        destinationAddress: req.destinationAddress || null,
        destinationPlaceId: req.destinationPlaceId ?? null,
        distanceM: route.distanceMeters,
        durationS: route.durationSeconds,
        amountCents: computeFare(rule, route.distanceMeters, route.durationSeconds),
        currency: rule.currency,
        polyline: route.polyline,
        expiresAt,
      })),
    });

    const order = VehicleCategory.options;
    quotes.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));
    return {
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
      polyline: route.polyline,
      expiresAt: expiresAt.toISOString(),
      options: quotes.map((q) => ({
        quoteId: q.id,
        category: q.category,
        amount: { amountCents: q.amountCents, currency: q.currency },
      })),
    };
  }

  /** La tarifa vigente de cada categoría: la de `valid_from` más reciente que ya empezó. */
  async currentRules(now = new Date()): Promise<FareRule[]> {
    const rules = await this.prisma.fareRule.findMany({
      where: { validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }] },
      orderBy: { validFrom: 'desc' },
    });
    const byCategory = new Map<string, FareRule>();
    for (const rule of rules) {
      if (!byCategory.has(rule.category)) byCategory.set(rule.category, rule);
    }
    return [...byCategory.values()];
  }

  /** Tarifas en el panel (11.1, paso 8): las vigentes, las programadas y el historial reciente. */
  async adminList(now = new Date()): Promise<AdminFareRules> {
    const [rules, current] = await Promise.all([
      this.prisma.fareRule.findMany({ orderBy: { validFrom: 'desc' }, take: 100 }),
      this.currentRules(now),
    ]);
    const currentIds = new Set(current.map((r) => r.id));
    const creators = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rules.flatMap((r) => (r.createdBy ? [r.createdBy] : [])))] } },
      select: { id: true, fullName: true },
    });
    const names = new Map(creators.map((u) => [u.id, u.fullName]));
    return {
      rules: rules.map((r) => ({
        id: r.id,
        category: r.category,
        baseCents: r.baseCents,
        perKmCents: r.perKmCents,
        perMinCents: r.perMinCents,
        minFareCents: r.minFareCents,
        currency: r.currency,
        validFrom: r.validFrom.toISOString(),
        validTo: r.validTo?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        createdByName: r.createdBy ? (names.get(r.createdBy) ?? null) : null,
        current: currentIds.has(r.id),
      })),
    };
  }

  /**
   * Nueva versión de tarifa (8.14, paso 5): nunca se edita la vigente. Empieza ahora o en el
   * futuro; las cotizaciones ya hechas conservan el precio con el que se cotizaron.
   */
  async createRule(
    adminId: string,
    body: CreateFareRuleRequest,
    ip: string | null,
    now = new Date(),
  ): Promise<void> {
    const validFrom = body.validFrom ? new Date(body.validFrom) : now;
    // Un minuto de margen por la diferencia de reloj entre el navegador y el servidor.
    if (validFrom.getTime() < now.getTime() - 60_000) {
      throw new ApiException(422, 'VALIDATION_FAILED', 'La tarifa no puede empezar en el pasado.');
    }
    if (body.minFareCents < body.baseCents) {
      throw new ApiException(
        422,
        'VALIDATION_FAILED',
        'La tarifa mínima no puede ser menor que el banderazo.',
      );
    }
    const rule = await this.prisma.fareRule.create({
      data: {
        category: body.category,
        baseCents: body.baseCents,
        perKmCents: body.perKmCents,
        perMinCents: body.perMinCents,
        minFareCents: body.minFareCents,
        currency: DEFAULT_CURRENCY,
        validFrom,
        createdBy: adminId,
      },
    });
    await this.audit.log({
      actorId: adminId,
      action: 'admin.fare_rule_created',
      entity: 'fare_rule',
      entityId: rule.id,
      ip,
      meta: { ...body, validFrom: validFrom.toISOString() },
    });
  }

  /** Borra las cotizaciones caducadas que no acabaron en viaje (8.15, cada hora). */
  async purgeExpired(now = new Date()): Promise<number> {
    const { count } = await this.prisma.fareQuote.deleteMany({
      where: { expiresAt: { lt: new Date(now.getTime() - 3600_000) }, trip: { is: null } },
    });
    return count;
  }
}
