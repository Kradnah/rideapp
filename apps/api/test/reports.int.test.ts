import { randomUUID } from 'node:crypto';
import { AdminReport } from '@rideapp/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FieldCrypto } from '../src/common/crypto/field-crypto.js';
import { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { createAdmin } from '../src/modules/admin/admin-provisioning.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { TokenService } from '../src/modules/auth/token.service.js';
import { type IntegrationApp, startIntegrationApp } from './helpers/int-app.js';
import { tripKit } from './helpers/trip-kit.js';

/** Fase 6: informes básicos del panel. */

let t: IntegrationApp;
let prisma: PrismaService;
let adminToken: string;

beforeAll(async () => {
  t = await startIntegrationApp();
  prisma = t.app.get(PrismaService);
  const admin = await createAdmin(
    { prisma, crypto: t.app.get(FieldCrypto), passwords: new PasswordService() },
    {
      email: `admin-${randomUUID()}@example.com`,
      fullName: 'Admin',
      password: 'panel-girardot-seguro-2026',
    },
  );
  adminToken = await t.app.get(TokenService).signAccessToken({
    sub: admin.userId,
    role: 'ADMIN',
    sid: randomUUID(),
    amr: ['pwd', 'totp'],
  });
}, 240_000);

afterAll(async () => {
  await t?.stop();
});

const kit = tripKit(() => t);

describe('GET /admin/reports', () => {
  it('agrega por día de Colombia y por hora', async () => {
    const passenger = await kit.register('PASSENGER');
    const driver = await kit.approvedDriver();
    const vehicle = await prisma.vehicle.findFirstOrThrow({ where: { driverId: driver.id } });

    /** Viaje con fecha forzada (las horas son UTC; Colombia es UTC−5). */
    const tripAt = async (
      iso: string,
      status: 'COMPLETED' | 'CANCELLED' | 'NO_DRIVERS',
      cents: number,
    ) => {
      const q = await kit.quote(passenger.token);
      const quote = await prisma.fareQuote.findUniqueOrThrow({
        where: { id: q.options[0]!.quoteId },
      });
      const at = new Date(iso);
      await prisma.trip.create({
        data: {
          passengerId: passenger.id,
          quoteId: quote.id,
          category: quote.category,
          paymentMethod: 'CASH',
          originLat: quote.originLat,
          originLng: quote.originLng,
          destinationLat: quote.destinationLat,
          destinationLng: quote.destinationLng,
          distanceM: 3000,
          durationS: 600,
          polyline: quote.polyline,
          amountCents: cents,
          currency: 'COP',
          pin: '1234',
          status,
          requestedAt: at,
          ...(status === 'COMPLETED' && {
            driverId: driver.id,
            vehicleId: vehicle.id,
            acceptedAt: new Date(at.getTime() + 60_000),
            startedAt: new Date(at.getTime() + 300_000),
            completedAt: new Date(at.getTime() + 900_000),
            finalAmountCents: cents,
          }),
          ...(status === 'CANCELLED' && { cancelledAt: at, cancelledBy: 'PASSENGER' as const }),
        },
      });
    };
    // 2026-03-10 en Colombia: 08:30 y 23:30 (esta última es 04:30 UTC del día 11).
    await tripAt('2026-03-10T13:30:00Z', 'COMPLETED', 1_000_000);
    await tripAt('2026-03-11T04:30:00Z', 'COMPLETED', 2_000_000);
    await tripAt('2026-03-11T15:00:00Z', 'CANCELLED', 900_000);
    await tripAt('2026-03-12T15:00:00Z', 'NO_DRIVERS', 900_000);
    // Fuera del rango.
    await tripAt('2026-03-13T15:00:00Z', 'COMPLETED', 5_000_000);

    const res = await t.call('GET', '/admin/reports?from=2026-03-10&to=2026-03-12', {
      token: adminToken,
    });
    expect(res.statusCode, res.body).toBe(200);
    const report = AdminReport.parse(res.json());
    expect(report.trips).toEqual({
      requested: 4,
      completed: 2,
      cancelledByPassenger: 1,
      cancelledByDriver: 0,
      cancelledBySystem: 0,
      noDrivers: 1,
    });
    expect(report.revenue).toEqual({ totalCents: 3_000_000, cashCents: 3_000_000, cardCents: 0 });
    expect(report.averages).toMatchObject({
      fareCents: 1_500_000,
      durationS: 600,
      waitToAssignS: 60,
    });
    expect(report.days.map((d) => [d.date, d.requested, d.completed])).toEqual([
      ['2026-03-10', 2, 2],
      ['2026-03-11', 1, 0],
      ['2026-03-12', 1, 0],
    ]);
    expect(report.requestsByHour[8]).toBe(1);
    expect(report.requestsByHour[23]).toBe(1);
    expect(report.requestsByHour[10]).toBe(2);
  });

  it('valida el rango y exige admin con TOTP', async () => {
    const bad = await t.call('GET', '/admin/reports?from=2026-03-12&to=2026-03-10', {
      token: adminToken,
    });
    expect(bad.statusCode).toBe(400);
    const tooLong = await t.call('GET', '/admin/reports?from=2026-01-01&to=2026-06-01', {
      token: adminToken,
    });
    expect(tooLong.statusCode).toBe(400);
    const passenger = await kit.register('PASSENGER');
    expect(
      (
        await t.call('GET', '/admin/reports?from=2026-03-10&to=2026-03-12', {
          token: passenger.token,
        })
      ).statusCode,
    ).toBe(403);
  });
});
