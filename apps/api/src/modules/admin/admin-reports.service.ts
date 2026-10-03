import { Injectable } from '@nestjs/common';
import { type AdminReport, type AdminReportQuery, DEFAULT_CURRENCY } from '@rideapp/contracts';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

const DAY_MS = 86_400_000;

/** Medianoche de Colombia (UTC−5, sin horario de verano) del día dado, en UTC. */
const colombiaMidnight = (day: string) => new Date(`${day}T05:00:00.000Z`);

const toInt = (v: unknown) => Number(v ?? 0);
const toAvg = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v)));

/**
 * Informes básicos del panel (Fase 6): agregados por día y hora, sin datos personales.
 * Las consultas filtran por `requested_at` (índice `trips(requested_at)`).
 */
@Injectable()
export class AdminReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async report(query: AdminReportQuery): Promise<AdminReport> {
    const from = colombiaMidnight(query.from);
    const to = new Date(colombiaMidnight(query.to).getTime() + DAY_MS);

    const [totals, days, hours, ratings, users] = await Promise.all([
      this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT
          count(*) AS requested,
          count(*) FILTER (WHERE t.status = 'COMPLETED') AS completed,
          count(*) FILTER (WHERE t.status = 'CANCELLED' AND t.cancelled_by = 'PASSENGER') AS by_passenger,
          count(*) FILTER (WHERE t.status = 'CANCELLED' AND t.cancelled_by = 'DRIVER') AS by_driver,
          count(*) FILTER (WHERE t.status = 'CANCELLED' AND t.cancelled_by = 'SYSTEM') AS by_system,
          count(*) FILTER (WHERE t.status = 'NO_DRIVERS') AS no_drivers,
          coalesce(sum(coalesce(t.final_amount_cents, t.amount_cents))
            FILTER (WHERE t.status = 'COMPLETED'), 0) AS revenue,
          coalesce(sum(coalesce(t.final_amount_cents, t.amount_cents))
            FILTER (WHERE t.status = 'COMPLETED' AND t.payment_method = 'CASH'), 0) AS cash,
          coalesce(sum(coalesce(t.final_amount_cents, t.amount_cents))
            FILTER (WHERE t.status = 'COMPLETED' AND t.payment_method = 'FAKE_CARD'), 0) AS card,
          avg(coalesce(t.final_amount_cents, t.amount_cents)) FILTER (WHERE t.status = 'COMPLETED') AS avg_fare,
          avg(t.distance_m) FILTER (WHERE t.status = 'COMPLETED') AS avg_distance,
          avg(extract(epoch FROM t.completed_at - t.started_at))
            FILTER (WHERE t.status = 'COMPLETED' AND t.started_at IS NOT NULL) AS avg_duration,
          avg(extract(epoch FROM t.accepted_at - t.requested_at))
            FILTER (WHERE t.accepted_at IS NOT NULL) AS avg_wait
        FROM trips t
        WHERE t.requested_at >= ${from} AND t.requested_at < ${to}`,
      this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT
          to_char(t.requested_at AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD') AS day,
          count(*) AS requested,
          count(*) FILTER (WHERE t.status = 'COMPLETED') AS completed,
          count(*) FILTER (WHERE t.status = 'CANCELLED') AS cancelled,
          count(*) FILTER (WHERE t.status = 'NO_DRIVERS') AS no_drivers,
          coalesce(sum(coalesce(t.final_amount_cents, t.amount_cents))
            FILTER (WHERE t.status = 'COMPLETED'), 0) AS revenue
        FROM trips t
        WHERE t.requested_at >= ${from} AND t.requested_at < ${to}
        GROUP BY 1`,
      this.prisma.$queryRaw<{ hour: number; n: bigint }[]>`
        SELECT extract(hour FROM t.requested_at AT TIME ZONE 'America/Bogota')::int AS hour,
               count(*) AS n
        FROM trips t
        WHERE t.requested_at >= ${from} AND t.requested_at < ${to}
        GROUP BY 1`,
      this.prisma.rating.aggregate({
        where: { createdAt: { gte: from, lt: to } },
        _avg: { score: true },
      }),
      this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT
          (SELECT count(*) FROM users
            WHERE role = 'PASSENGER' AND created_at >= ${from} AND created_at < ${to}) AS passengers,
          (SELECT count(*) FROM users
            WHERE role = 'DRIVER' AND created_at >= ${from} AND created_at < ${to}) AS drivers,
          (SELECT count(*) FROM driver_profiles
            WHERE approved_at >= ${from} AND approved_at < ${to}) AS approved`,
    ]);

    const t = totals[0] ?? {};
    const byDay = new Map(days.map((d) => [String(d.day), d]));
    const allDays: AdminReport['days'] = [];
    for (let at = colombiaMidnight(query.from).getTime(); at < to.getTime(); at += DAY_MS) {
      const date = new Date(at - 5 * 3600_000).toISOString().slice(0, 10);
      const d = byDay.get(date);
      allDays.push({
        date,
        requested: toInt(d?.requested),
        completed: toInt(d?.completed),
        cancelled: toInt(d?.cancelled),
        noDrivers: toInt(d?.no_drivers),
        revenueCents: toInt(d?.revenue),
      });
    }
    const requestsByHour = Array.from({ length: 24 }, () => 0);
    for (const h of hours) requestsByHour[h.hour] = Number(h.n);
    const avgRating = ratings._avg.score;
    const u = users[0] ?? {};

    return {
      from: query.from,
      to: query.to,
      currency: DEFAULT_CURRENCY,
      trips: {
        requested: toInt(t.requested),
        completed: toInt(t.completed),
        cancelledByPassenger: toInt(t.by_passenger),
        cancelledByDriver: toInt(t.by_driver),
        cancelledBySystem: toInt(t.by_system),
        noDrivers: toInt(t.no_drivers),
      },
      revenue: { totalCents: toInt(t.revenue), cashCents: toInt(t.cash), cardCents: toInt(t.card) },
      averages: {
        fareCents: toAvg(t.avg_fare),
        distanceM: toAvg(t.avg_distance),
        durationS: toAvg(t.avg_duration),
        waitToAssignS: toAvg(t.avg_wait),
        rating: avgRating === null ? null : Math.round(avgRating * 100) / 100,
      },
      users: {
        newPassengers: toInt(u.passengers),
        newDrivers: toInt(u.drivers),
        driversApproved: toInt(u.approved),
      },
      days: allDays,
      requestsByHour,
    };
  }
}
