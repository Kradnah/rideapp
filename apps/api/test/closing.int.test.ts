import { randomUUID } from 'node:crypto';
import {
  AdminAuditList,
  AdminFareRules,
  AdminOverview,
  AdminTripDetail,
  AdminUserDetail,
  AdminUserList,
  DriverEarnings,
  type PaymentMethod,
  Trip,
  TripHistory,
} from '@rideapp/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FieldCrypto } from '../src/common/crypto/field-crypto.js';
import { MAILER, type MailMessage, type Mailer } from '../src/infra/mail/mailer.js';
import { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { createAdmin } from '../src/modules/admin/admin-provisioning.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { TokenService } from '../src/modules/auth/token.service.js';
import {
  PUSH_SENDER,
  type PushMessage,
  type PushSender,
  type PushTicket,
} from '../src/modules/notifications/push-sender.js';
import { type IntegrationApp, startIntegrationApp } from './helpers/int-app.js';
import { tripKit } from './helpers/trip-kit.js';

/**
 * Fase 5: cierre del viaje. Pago (efectivo con confirmación y tarjeta demo), recibo, calificaciones,
 * historial, ganancias, push y panel (usuarios, tarifas, auditoría).
 */

const mails: MailMessage[] = [];
const recordingMailer: Mailer = {
  enabled: true,
  send: (m) => {
    mails.push(m);
    return Promise.resolve();
  },
};

const pushes: PushMessage[] = [];
/** Expo de mentira: los tokens con "Gone" responden DeviceNotRegistered. */
const fakePush: PushSender = {
  enabled: true,
  send: (messages) => {
    pushes.push(...messages);
    return Promise.resolve(
      messages.map<PushTicket>((m) =>
        m.to.includes('Gone')
          ? { ok: false, unregistered: true, error: 'DeviceNotRegistered' }
          : { ok: true },
      ),
    );
  },
};

let t: IntegrationApp;
let prisma: PrismaService;
let adminToken: string;
let adminId: string;

beforeAll(async () => {
  t = await startIntegrationApp([
    { provide: MAILER, useValue: recordingMailer },
    { provide: PUSH_SENDER, useValue: fakePush },
  ]);
  prisma = t.app.get(PrismaService);
  const admin = await createAdmin(
    { prisma, crypto: t.app.get(FieldCrypto), passwords: new PasswordService() },
    {
      email: `admin-${randomUUID()}@example.com`,
      fullName: 'Admin Demo',
      password: 'panel-girardot-seguro-2026',
    },
  );
  adminId = admin.userId;
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
const { register, approvedDriver, quote } = kit;

/** Espera a que se cumpla una condición (jobs de BullMQ). */
async function eventually(check: () => boolean | Promise<boolean>, ms = 8_000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return;
    await kit.sleep(100);
  }
  throw new Error('La condición no se cumplió a tiempo');
}

/**
 * Viaje ya en curso con un conductor asignado. El emparejamiento y la llegada se prueban en
 * trips.int y live-trips.int: aquí se pone en IN_PROGRESS directamente en la BD.
 */
async function inProgressTrip(paymentMethod: PaymentMethod = 'CASH') {
  const passenger = await register('PASSENGER', 'Pía Pasajera');
  const driver = await approvedDriver('Nora Conductora');
  const q = await quote(passenger.token);
  const created = await t.call('POST', '/trips', {
    token: passenger.token,
    body: { quoteId: q.options.find((o) => o.category === 'STANDARD')!.quoteId, paymentMethod },
    headers: { 'idempotency-key': randomUUID() },
  });
  expect(created.statusCode, created.body).toBe(201);
  const trip = Trip.parse(created.json());
  const vehicle = await prisma.vehicle.findFirstOrThrow({ where: { driverId: driver.id } });
  await prisma.trip.update({
    where: { id: trip.id },
    data: {
      status: 'IN_PROGRESS',
      driverId: driver.id,
      vehicleId: vehicle.id,
      acceptedAt: new Date(),
      arrivedAt: new Date(),
      startedAt: new Date(),
    },
  });
  return { passenger, driver, trip };
}

async function completedTrip(paymentMethod: PaymentMethod = 'CASH') {
  const ctx = await inProgressTrip(paymentMethod);
  const res = await t.call('POST', `/trips/${ctx.trip.id}/complete`, {
    token: ctx.driver.token,
    headers: { 'idempotency-key': randomUUID() },
  });
  expect(res.statusCode, res.body).toBe(200);
  return { ...ctx, completed: Trip.parse(res.json()) };
}

const getTrip = async (token: string, id: string) => {
  const res = await t.call('GET', `/trips/${id}`, { token });
  expect(res.statusCode, res.body).toBe(200);
  return Trip.parse(res.json());
};

// ---------- pagos y recibo ----------

describe('pago al terminar', () => {
  it('efectivo: pendiente hasta que el conductor confirma; luego recibo, una sola vez', async () => {
    const { passenger, driver, trip, completed } = await completedTrip('CASH');
    expect(completed.payment).toMatchObject({ method: 'CASH', status: 'PENDING', paidAt: null });
    expect(completed.payment!.amount).toEqual(trip.amount);

    // Otro conductor no puede confirmarlo; el pasajero tampoco (rol).
    const other = await approvedDriver('Otro Conductor');
    expect(
      (await t.call('POST', `/trips/${trip.id}/payment/cash-collected`, { token: other.token }))
        .statusCode,
    ).toBe(404);
    expect(
      (await t.call('POST', `/trips/${trip.id}/payment/cash-collected`, { token: passenger.token }))
        .statusCode,
    ).toBe(403);

    const before = mails.length;
    const confirmed = await t.call('POST', `/trips/${trip.id}/payment/cash-collected`, {
      token: driver.token,
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(Trip.parse(confirmed.json()).payment).toMatchObject({ status: 'CAPTURED' });
    // Repetir no hace nada (reintento con mala conexión).
    const again = await t.call('POST', `/trips/${trip.id}/payment/cash-collected`, {
      token: driver.token,
    });
    expect(again.statusCode).toBe(200);

    // El pasajero ve el pago y recibe un único recibo, sin el PIN ni datos del conductor de más.
    expect((await getTrip(passenger.token, trip.id)).payment?.status).toBe('CAPTURED');
    await eventually(() => mails.length > before);
    await kit.sleep(500);
    const receipts = mails.slice(before).filter((m) => m.subject.startsWith('Tu recibo'));
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.to).toMatch(/^passenger-/);
    expect(receipts[0]!.text).toContain('Efectivo');
    expect(receipts[0]!.text).toContain('Nora Conductora');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'payment.cash_confirmed', entityId: trip.id },
    });
    expect(audit?.actorId).toBe(driver.id);
  });

  it('tarjeta demo: cobrada al completar; confirmar efectivo no aplica', async () => {
    const { driver, trip, completed } = await completedTrip('FAKE_CARD');
    expect(completed.payment).toMatchObject({ method: 'FAKE_CARD', status: 'CAPTURED' });
    expect(completed.payment!.paidAt).not.toBeNull();
    const payment = await prisma.payment.findUniqueOrThrow({ where: { tripId: trip.id } });
    expect(payment.providerRef).toMatch(/^fake_/);
    const res = await t.call('POST', `/trips/${trip.id}/payment/cash-collected`, {
      token: driver.token,
    });
    expect(res.statusCode).toBe(409);
  });

  it('un reintento de "Finalizar" no crea un segundo pago', async () => {
    const { driver, trip } = await inProgressTrip('CASH');
    const key = randomUUID();
    for (let i = 0; i < 2; i++) {
      const res = await t.call('POST', `/trips/${trip.id}/complete`, {
        token: driver.token,
        headers: { 'idempotency-key': key },
      });
      expect(res.statusCode, res.body).toBe(200);
    }
    expect(await prisma.payment.count({ where: { tripId: trip.id } })).toBe(1);
  });
});

// ---------- calificaciones ----------

describe('calificaciones', () => {
  it('cada parte califica una vez; el promedio se actualiza y se ve en el siguiente viaje', async () => {
    const { passenger, driver, trip } = await completedTrip();
    const stranger = await register('PASSENGER', 'Otra Persona');

    expect((await getTrip(passenger.token, trip.id)).rateableUntil).not.toBeNull();

    const rate = (token: string, body: object) =>
      t.call('POST', `/trips/${trip.id}/rating`, { token, body });

    expect((await rate(stranger.token, { score: 1 })).statusCode).toBe(404);
    expect((await rate(passenger.token, { score: 6 })).statusCode).toBe(400);
    expect((await rate(passenger.token, { score: 5, comment: 'x'.repeat(501) })).statusCode).toBe(
      400,
    );

    const byPassenger = await rate(passenger.token, {
      score: 5,
      comment: '  Muy amable <script>alert(1)</script>  ',
    });
    expect(byPassenger.statusCode, byPassenger.body).toBe(200);
    const seen = Trip.parse(byPassenger.json());
    expect(seen.myRating).toBe(5);
    expect(seen.rateableUntil).toBeNull();
    expect((await rate(passenger.token, { score: 1 })).statusCode).toBe(409);

    expect((await rate(driver.token, { score: 4 })).statusCode).toBe(200);

    const [d, p] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: driver.id } }),
      prisma.user.findUniqueOrThrow({ where: { id: passenger.id } }),
    ]);
    expect([d.ratingSum, d.ratingCount]).toEqual([5, 1]);
    expect([p.ratingSum, p.ratingCount]).toEqual([4, 1]);

    // El conductor ve la calificación del pasajero en el viaje.
    expect((await getTrip(driver.token, trip.id)).passenger?.rating).toBe(4);

    // El panel ve ambas, con el comentario tal cual (el panel lo escapa al pintarlo).
    const detail = AdminTripDetail.parse(
      (await t.call('GET', `/admin/trips/${trip.id}`, { token: adminToken })).json(),
    );
    expect(detail.ratings).toHaveLength(2);
    expect(detail.ratings.find((r) => r.by === 'PASSENGER')).toMatchObject({
      score: 5,
      comment: 'Muy amable <script>alert(1)</script>',
    });
    expect(detail.payment).toMatchObject({ status: 'PENDING' });
  });

  it('no se califica un viaje sin completar ni pasado el plazo de 7 días', async () => {
    const active = await inProgressTrip();
    const early = await t.call('POST', `/trips/${active.trip.id}/rating`, {
      token: active.passenger.token,
      body: { score: 5 },
    });
    expect(early.statusCode).toBe(409);

    const { passenger, trip } = await completedTrip();
    await prisma.trip.update({
      where: { id: trip.id },
      data: { completedAt: new Date(Date.now() - 8 * 86_400_000) },
    });
    expect((await getTrip(passenger.token, trip.id)).rateableUntil).toBeNull();
    const late = await t.call('POST', `/trips/${trip.id}/rating`, {
      token: passenger.token,
      body: { score: 5 },
    });
    expect(late.statusCode).toBe(409);
  });
});

// ---------- historial y ganancias ----------

describe('historial y ganancias', () => {
  it('cada uno ve solo sus viajes terminados, paginados', async () => {
    const first = await completedTrip('CASH');
    const passenger = first.passenger;
    // Segundo viaje del mismo pasajero, cancelado.
    const q = await quote(passenger.token);
    const second = Trip.parse(
      (
        await t.call('POST', '/trips', {
          token: passenger.token,
          body: { quoteId: q.options[0]!.quoteId, paymentMethod: 'CASH' },
          headers: { 'idempotency-key': randomUUID() },
        })
      ).json(),
    );
    expect(
      (await t.call('POST', `/trips/${second.id}/cancel`, { token: passenger.token, body: {} }))
        .statusCode,
    ).toBe(200);

    const page1 = TripHistory.parse(
      (await t.call('GET', '/trips?limit=1', { token: passenger.token })).json(),
    );
    expect(page1.items.map((i) => i.id)).toEqual([second.id]);
    expect(page1.nextCursor).toBe(second.id);
    const page2 = TripHistory.parse(
      (
        await t.call('GET', `/trips?limit=1&cursor=${page1.nextCursor}`, {
          token: passenger.token,
        })
      ).json(),
    );
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0]).toMatchObject({
      id: first.trip.id,
      status: 'COMPLETED',
      counterpartName: 'Nora Conductora',
    });
    expect(page2.nextCursor).toBeNull();

    const driverHistory = TripHistory.parse(
      (await t.call('GET', '/trips', { token: first.driver.token })).json(),
    );
    expect(driverHistory.items.map((i) => i.id)).toEqual([first.trip.id]);
    expect(driverHistory.items[0]!.counterpartName).toBe('Pía Pasajera');

    const stranger = await register('PASSENGER');
    const empty = TripHistory.parse(
      (await t.call('GET', '/trips', { token: stranger.token })).json(),
    );
    expect(empty.items).toEqual([]);
  });

  it('ganancias del conductor por día de Colombia, separadas por medio de pago', async () => {
    const cash = await completedTrip('CASH');
    const driver = cash.driver;
    // Segundo viaje del mismo conductor, con tarjeta.
    const card = await inProgressTripFor(driver, 'FAKE_CARD');
    expect(
      (
        await t.call('POST', `/trips/${card.id}/complete`, {
          token: driver.token,
          headers: { 'idempotency-key': randomUUID() },
        })
      ).statusCode,
    ).toBe(200);

    const today = new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);
    const res = await t.call('GET', `/drivers/me/earnings?from=${today}&to=${today}`, {
      token: driver.token,
    });
    expect(res.statusCode, res.body).toBe(200);
    const earnings = DriverEarnings.parse(res.json());
    expect(earnings.trips).toBe(2);
    expect(earnings.cash.amountCents).toBe(cash.trip.amount.amountCents);
    expect(earnings.card.amountCents).toBe(card.amount.amountCents);
    expect(earnings.total.amountCents).toBe(cash.trip.amount.amountCents + card.amount.amountCents);
    expect(earnings.days).toEqual([
      { date: today, trips: 2, amountCents: earnings.total.amountCents },
    ]);

    // Ayer no hubo viajes; los rangos inválidos o demasiado largos se rechazan.
    const yesterday = new Date(Date.parse(today) - 86_400_000).toISOString().slice(0, 10);
    const none = DriverEarnings.parse(
      (
        await t.call('GET', `/drivers/me/earnings?from=${yesterday}&to=${yesterday}`, {
          token: driver.token,
        })
      ).json(),
    );
    expect(none.trips).toBe(0);
    for (const qs of [`from=${today}&to=${yesterday}`, 'from=2026-01-01&to=2026-06-01', '']) {
      const bad = await t.call('GET', `/drivers/me/earnings?${qs}`, { token: driver.token });
      expect(bad.statusCode, qs).toBe(400);
    }
    expect(
      (
        await t.call('GET', `/drivers/me/earnings?from=${today}&to=${today}`, {
          token: cash.passenger.token,
        })
      ).statusCode,
    ).toBe(403);
  });
});

/** Otro viaje en curso para un conductor que ya existe. */
async function inProgressTripFor(
  driver: { id: string; token: string },
  paymentMethod: PaymentMethod,
) {
  const passenger = await register('PASSENGER', 'Pablo Pasajero');
  const q = await quote(passenger.token);
  const trip = Trip.parse(
    (
      await t.call('POST', '/trips', {
        token: passenger.token,
        body: { quoteId: q.options.find((o) => o.category === 'STANDARD')!.quoteId, paymentMethod },
        headers: { 'idempotency-key': randomUUID() },
      })
    ).json(),
  );
  const vehicle = await prisma.vehicle.findFirstOrThrow({ where: { driverId: driver.id } });
  await prisma.trip.update({
    where: { id: trip.id },
    data: { status: 'IN_PROGRESS', driverId: driver.id, vehicleId: vehicle.id },
  });
  return trip;
}

// ---------- push ----------

describe('notificaciones push', () => {
  const token = (tag: string) => `ExponentPushToken[${tag}${randomUUID().slice(0, 8)}]`;

  it('registra tokens, avisa sin datos sensibles y borra los que Expo da por perdidos', async () => {
    const passenger = await register('PASSENGER');
    const good = token('Good');
    const gone = token('Gone');
    for (const tk of [good, gone]) {
      const res = await t.call('POST', '/me/push-tokens', {
        token: passenger.token,
        body: { token: tk, platform: 'android' },
      });
      expect(res.statusCode, res.body).toBe(204);
    }
    expect(
      (
        await t.call('POST', '/me/push-tokens', {
          token: passenger.token,
          body: { token: 'no-es-un-token', platform: 'android' },
        })
      ).statusCode,
    ).toBe(400);

    // El conductor cancela tras aceptar: el pasajero recibe un aviso genérico.
    const driver = await approvedDriver();
    const q = await quote(passenger.token);
    const trip = Trip.parse(
      (
        await t.call('POST', '/trips', {
          token: passenger.token,
          body: { quoteId: q.options[0]!.quoteId, paymentMethod: 'CASH' },
          headers: { 'idempotency-key': randomUUID() },
        })
      ).json(),
    );
    const vehicle = await prisma.vehicle.findFirstOrThrow({ where: { driverId: driver.id } });
    await prisma.trip.update({
      where: { id: trip.id },
      data: { status: 'DRIVER_ASSIGNED', driverId: driver.id, vehicleId: vehicle.id },
    });
    const cancelled = await t.call('POST', `/trips/${trip.id}/cancel`, {
      token: driver.token,
      body: {},
    });
    expect(cancelled.statusCode, cancelled.body).toBe(200);

    await eventually(() => pushes.some((m) => m.to === good));
    const sent = pushes.find((m) => m.to === good)!;
    expect(sent).toMatchObject({
      title: 'Tu conductor canceló el viaje',
      data: { type: 'trip.status', tripId: trip.id },
      channelId: 'trips',
    });
    expect(JSON.stringify(sent)).not.toContain('Parque');
    await eventually(async () => (await prisma.pushToken.count({ where: { token: gone } })) === 0);
    expect(await prisma.pushToken.count({ where: { token: good } })).toBe(1);
  });

  it('un token pasa al último usuario que lo registra y solo su dueño lo borra', async () => {
    const a = await register('PASSENGER');
    const b = await register('PASSENGER');
    const shared = token('Shared');
    for (const u of [a, b]) {
      await t.call('POST', '/me/push-tokens', {
        token: u.token,
        body: { token: shared, platform: 'ios' },
      });
    }
    expect((await prisma.pushToken.findUniqueOrThrow({ where: { token: shared } })).userId).toBe(
      b.id,
    );
    await t.call('DELETE', '/me/push-tokens', { token: a.token, body: { token: shared } });
    expect(await prisma.pushToken.count({ where: { token: shared } })).toBe(1);
    await t.call('DELETE', '/me/push-tokens', { token: b.token, body: { token: shared } });
    expect(await prisma.pushToken.count({ where: { token: shared } })).toBe(0);
  });
});

// ---------- panel ----------

describe('panel: usuarios, tarifas y auditoría', () => {
  const admin = (method: 'GET' | 'POST', path: string, body?: object) =>
    t.call(method, `/admin${path}`, { token: adminToken, body });

  it('busca usuarios, enmascara el teléfono y audita revelarlo', async () => {
    const user = await register('PASSENGER', 'Zoe Buscable');
    await t.call('PATCH', '/me', { token: user.token, body: { phone: '+573001234567' } });

    const list = AdminUserList.parse((await admin('GET', '/users?q=zoe%20busc')).json());
    expect(list.items.map((u) => u.id)).toContain(user.id);
    const detail = AdminUserDetail.parse((await admin('GET', `/users/${user.id}`)).json());
    expect(detail.phoneMasked).toBe('+57 *** *** 4567');
    expect(detail.providers).toEqual(['password']);
    expect(detail.consents).toHaveLength(1);

    const revealed = await admin('POST', `/users/${user.id}/reveal-phone`);
    expect(revealed.json()).toEqual({ value: '+573001234567' });
    const audit = AdminAuditList.parse(
      (await admin('GET', `/audit?action=admin.user_field&entityId=${user.id}`)).json(),
    );
    expect(audit.items).toHaveLength(1);
    expect(audit.items[0]).toMatchObject({ actorId: adminId, actorName: 'Admin Demo' });

    // Solo el admin con TOTP.
    expect((await t.call('GET', '/admin/users', { token: user.token })).statusCode).toBe(403);
  });

  it('suspender cierra las sesiones e impide entrar; reactivar lo devuelve', async () => {
    const email = `suspendible-${randomUUID()}@example.com`;
    const password = 'caballo-azul-girardot';
    const reg = await t.call('POST', '/auth/register', {
      body: {
        email,
        password,
        fullName: 'Susana Suspendida',
        role: 'PASSENGER',
        consent: kit.consent,
      },
    });
    expect(reg.statusCode, reg.body).toBe(201);
    const { accessToken } = reg.json() as { accessToken: string };
    const me = await t.call('GET', '/me', { token: accessToken });
    const id = (me.json() as { id: string }).id;

    expect((await admin('POST', `/users/${id}/suspend`, { reason: 'no' })).statusCode).toBe(400);
    const suspended = await admin('POST', `/users/${id}/suspend`, {
      reason: 'Reportes de mal comportamiento',
    });
    expect(suspended.statusCode, suspended.body).toBe(204);
    expect((await t.call('GET', '/me', { token: accessToken })).statusCode).toBe(401);
    const login = await t.call('POST', '/auth/login', { body: { email, password } });
    expect(login.json()).toMatchObject({ code: 'ACCOUNT_DISABLED' });
    expect(AdminUserDetail.parse((await admin('GET', `/users/${id}`)).json())).toMatchObject({
      status: 'SUSPENDED',
      statusReason: 'Reportes de mal comportamiento',
      activeSessions: 0,
    });

    expect((await admin('POST', `/users/${id}/reactivate`)).statusCode).toBe(204);
    expect((await t.call('POST', '/auth/login', { body: { email, password } })).statusCode).toBe(
      200,
    );
    // Un admin no se suspende desde el panel.
    expect(
      (await admin('POST', `/users/${adminId}/suspend`, { reason: 'Prueba de seguridad' }))
        .statusCode,
    ).toBe(403);
  });

  it('no suspende a quien tiene un viaje en curso', async () => {
    const { passenger, driver } = await inProgressTrip();
    for (const id of [passenger.id, driver.id]) {
      const res = await admin('POST', `/users/${id}/suspend`, { reason: 'Prueba de viaje activo' });
      expect(res.statusCode).toBe(409);
    }
  });

  it('una tarifa nueva no edita la vigente: se aplica a las cotizaciones siguientes', async () => {
    const before = AdminFareRules.parse((await admin('GET', '/fares')).json());
    const current = before.rules.find((r) => r.current && r.category === 'MOTO')!;

    const past = await admin('POST', '/fares', {
      category: 'MOTO',
      baseCents: 100_000,
      perKmCents: 50_000,
      perMinCents: 10_000,
      minFareCents: 400_000,
      validFrom: new Date(Date.now() - 3600_000).toISOString(),
    });
    expect(past.statusCode).toBe(422);
    const belowBase = await admin('POST', '/fares', {
      category: 'MOTO',
      baseCents: 500_000,
      perKmCents: 0,
      perMinCents: 0,
      minFareCents: 100_000,
    });
    expect(belowBase.statusCode).toBe(422);

    // Programada para mañana: todavía no es la vigente.
    const scheduled = await admin('POST', '/fares', {
      category: 'MOTO',
      baseCents: 900_000,
      perKmCents: 0,
      perMinCents: 0,
      minFareCents: 900_000,
      validFrom: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(scheduled.statusCode, scheduled.body).toBe(204);
    // Desde ya: precio plano de 7.000 COP.
    const now = await admin('POST', '/fares', {
      category: 'MOTO',
      baseCents: 700_000,
      perKmCents: 0,
      perMinCents: 0,
      minFareCents: 700_000,
    });
    expect(now.statusCode, now.body).toBe(204);

    const after = AdminFareRules.parse((await admin('GET', '/fares')).json());
    const moto = after.rules.filter((r) => r.category === 'MOTO');
    expect(moto.filter((r) => r.current)).toHaveLength(1);
    expect(moto.find((r) => r.current)).toMatchObject({
      baseCents: 700_000,
      createdByName: 'Admin Demo',
    });
    // La anterior sigue intacta (historial).
    expect(moto.find((r) => r.id === current.id)).toMatchObject({
      baseCents: current.baseCents,
      current: false,
    });

    const passenger = await register('PASSENGER');
    const q = await quote(passenger.token);
    expect(q.options.find((o) => o.category === 'MOTO')!.amount.amountCents).toBe(700_000);

    const audit = AdminAuditList.parse((await admin('GET', '/audit?action=admin.fare')).json());
    expect(audit.items.length).toBeGreaterThanOrEqual(2);
  });

  it('el dashboard incluye los cobros en efectivo pendientes', async () => {
    await completedTrip('CASH');
    const overview = AdminOverview.parse((await admin('GET', '/overview')).json());
    expect(overview.payments.pendingCash).toBeGreaterThanOrEqual(1);
    expect(overview.payments.capturedToday.currency).toBe('COP');
  });
});
