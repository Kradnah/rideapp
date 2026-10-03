import { randomUUID } from 'node:crypto';
import {
  GIRARDOT_CENTER,
  MeExport,
  NearbyDriversResponse,
  type SessionRevokedV1,
  SocketEvent,
  Trip,
} from '@rideapp/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { StorageService } from '../src/infra/storage/storage.service.js';
import { RetentionService } from '../src/modules/privacy/retention.service.js';
import { type IntegrationApp, startIntegrationApp } from './helpers/int-app.js';
import { tripKit } from './helpers/trip-kit.js';

/**
 * Fase 6: derechos del titular (exportar y eliminar la cuenta, 8.3 y 15.2) y retención (15.1).
 */

let t: IntegrationApp;
let prisma: PrismaService;

beforeAll(async () => {
  t = await startIntegrationApp();
  prisma = t.app.get(PrismaService);
}, 240_000);

afterAll(async () => {
  kit.disconnectAll();
  await t?.stop();
});

const kit = tripKit(() => t);
const { register, approvedDriver, quote } = kit;
const PASSWORD = 'caballo-azul-girardot';
const DAY = 24 * 3600_000;

/** Viaje terminado entre un pasajero y un conductor, con traza y calificación del pasajero. */
async function finishedTrip() {
  const passenger = await register('PASSENGER', 'Pía Pasajera');
  const driver = await approvedDriver('Nora Conductora');
  const q = await quote(passenger.token);
  const created = await t.call('POST', '/trips', {
    token: passenger.token,
    body: {
      quoteId: q.options.find((o) => o.category === 'STANDARD')!.quoteId,
      paymentMethod: 'CASH',
    },
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
  await prisma.tripRoutePoint.createMany({
    data: [
      { tripId: trip.id, at: new Date(), lat: 4.30412, lng: -74.80371 },
      { tripId: trip.id, at: new Date(), lat: 4.30533, lng: -74.80222 },
    ],
  });
  const done = await t.call('POST', `/trips/${trip.id}/complete`, {
    token: driver.token,
    headers: { 'idempotency-key': randomUUID() },
  });
  expect(done.statusCode, done.body).toBe(200);
  const rated = await t.call('POST', `/trips/${trip.id}/rating`, {
    token: passenger.token,
    body: { score: 5, comment: 'Muy amable, me dejó en la casa azul de la 10' },
  });
  expect(rated.statusCode, rated.body).toBe(200);
  return { passenger, driver, trip };
}

describe('GET /me/export', () => {
  it('devuelve los datos del titular; la traza solo al conductor', async () => {
    const { passenger, driver, trip } = await finishedTrip();

    const res = await t.call('GET', '/me/export', { token: passenger.token });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const data = MeExport.parse(res.json());
    expect(data.profile).toMatchObject({
      id: passenger.id,
      fullName: 'Pía Pasajera',
      role: 'PASSENGER',
    });
    expect(data.profile.loginMethods).toEqual(['password']);
    expect(data.consents).toHaveLength(1);
    expect(data.sessions.length).toBeGreaterThan(0);
    expect(data.driver).toBeNull();
    expect(data.trips).toHaveLength(1);
    expect(data.trips[0]).toMatchObject({ id: trip.id, as: 'PASSENGER', status: 'COMPLETED' });
    expect(data.trips[0]!.routePoints).toEqual([]);
    expect(data.ratingsGiven[0]).toMatchObject({ tripId: trip.id, score: 5 });
    // Nada de secretos: ni el hash de la contraseña ni el PIN.
    expect(res.body).not.toMatch(/argon2|passwordHash|"pin"/);

    const asDriver = MeExport.parse(
      (await t.call('GET', '/me/export', { token: driver.token })).json(),
    );
    expect(asDriver.driver).toMatchObject({ status: 'APPROVED', licenseLast4: '3456' });
    expect(asDriver.driver!.vehicles).toHaveLength(1);
    expect(asDriver.trips[0]).toMatchObject({ as: 'DRIVER' });
    expect(asDriver.trips[0]!.routePoints).toHaveLength(2);
    // Recibida, sin decir quién la dio.
    expect(asDriver.ratingsReceived[0]).toMatchObject({ score: 5 });
    expect(JSON.stringify(asDriver.ratingsReceived)).not.toContain(passenger.id);

    expect(
      await prisma.auditLog.count({
        where: { actorId: passenger.id, action: 'user.data_exported' },
      }),
    ).toBe(1);
  });

  it('exige sesión', async () => {
    expect((await t.call('GET', '/me/export')).statusCode).toBe(401);
  });
});

describe('DELETE /me', () => {
  it('pide la confirmación y la contraseña correcta', async () => {
    const p = await register('PASSENGER');
    expect((await t.call('DELETE', '/me', { token: p.token, body: {} })).statusCode).toBe(400);
    expect(
      (await t.call('DELETE', '/me', { token: p.token, body: { confirmation: 'ELIMINAR' } }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await t.call('DELETE', '/me', {
          token: p.token,
          body: { confirmation: 'ELIMINAR', password: 'otra-contraseña-larga' },
        })
      ).statusCode,
    ).toBe(403);
    expect((await t.call('GET', '/me', { token: p.token })).statusCode).toBe(200);
  });

  it('no con un viaje en curso', async () => {
    const p = await register('PASSENGER');
    const q = await quote(p.token);
    const created = await t.call('POST', '/trips', {
      token: p.token,
      body: { quoteId: q.options[0]!.quoteId, paymentMethod: 'CASH' },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(created.statusCode, created.body).toBe(201);
    const res = await t.call('DELETE', '/me', {
      token: p.token,
      body: { confirmation: 'ELIMINAR', password: PASSWORD },
    });
    expect(res.statusCode).toBe(409);
  });

  it('pasajero: anonimiza, cierra sesiones y conserva el viaje sin datos exactos', async () => {
    const { passenger, driver, trip } = await finishedTrip();
    const socket = await kit.connected(passenger.token);
    const revoked = new Promise<SessionRevokedV1>((resolve) =>
      socket.once(SocketEvent.SessionRevoked, resolve),
    );
    const before = await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } });

    const res = await t.call('DELETE', '/me', {
      token: passenger.token,
      body: { confirmation: 'ELIMINAR', password: PASSWORD },
    });
    expect(res.statusCode, res.body).toBe(204);
    expect(await revoked).toEqual({ reason: 'ACCOUNT_DELETED' });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: passenger.id } });
    expect(user).toMatchObject({
      email: null,
      passwordHash: null,
      phone: null,
      fullName: 'Usuario eliminado',
      status: 'DELETED',
    });
    expect(user.deletedAt).not.toBeNull();
    // El token ya no sirve y no se puede volver a entrar.
    expect((await t.call('GET', '/me', { token: passenger.token })).statusCode).toBe(401);
    expect(
      await prisma.refreshToken.count({ where: { userId: passenger.id, revokedAt: null } }),
    ).toBe(0);

    // El viaje sigue (ley fiscal), redondeado a ~1 km, sin direcciones, ruta ni traza.
    const after = await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } });
    expect(after.originLat).toBeCloseTo(Math.round(before.originLat * 100) / 100, 10);
    expect(after.destinationLng).toBeCloseTo(Math.round(before.destinationLng * 100) / 100, 10);
    expect(after).toMatchObject({ originAddress: null, destinationAddress: null, polyline: '' });
    expect(after.finalAmountCents).toBe(before.finalAmountCents);
    expect(await prisma.tripRoutePoint.count({ where: { tripId: trip.id } })).toBe(0);
    const rating = await prisma.rating.findFirstOrThrow({ where: { tripId: trip.id } });
    expect(rating).toMatchObject({ score: 5, comment: null });
    // La calificación recibida por el conductor no cambia.
    expect((await prisma.user.findUniqueOrThrow({ where: { id: driver.id } })).ratingCount).toBe(1);

    // El conductor sigue viendo el viaje en su historial, con el pasajero como "Usuario eliminado".
    const seen = await t.call('GET', `/trips/${trip.id}`, { token: driver.token });
    expect(seen.statusCode, seen.body).toBe(200);
    expect(JSON.stringify(seen.json())).not.toContain('Pía');

    expect(
      await prisma.auditLog.count({ where: { actorId: passenger.id, action: 'user.deleted' } }),
    ).toBe(1);

    // Se puede registrar otra cuenta con el mismo correo en el futuro (el email quedó libre).
  });

  it('conductor: sale de línea y se borran sus documentos', async () => {
    const driver = await kit.onlineDriverAt(GIRARDOT_CENTER, 'Daniel Borrable');
    const passenger = await register('PASSENGER');
    const nearby = async () => {
      const res = await t.call(
        'GET',
        `/drivers/nearby?lat=${GIRARDOT_CENTER.lat}&lng=${GIRARDOT_CENTER.lng}`,
        {
          token: passenger.token,
        },
      );
      expect(res.statusCode, res.body).toBe(200);
      return NearbyDriversResponse.parse(res.json()).drivers;
    };
    expect(await nearby()).toHaveLength(1);
    const storage = t.app.get(StorageService);
    const storageKey = `driver-documents/${randomUUID()}`;
    await storage.put(storageKey, Buffer.from('licencia'));
    await prisma.driverDocument.create({
      data: {
        driverId: driver.id,
        type: 'DRIVER_LICENSE',
        storageKey,
        mime: 'image/jpeg',
        sizeBytes: 8,
        sha256: 'x'.repeat(64),
      },
    });
    const res = await t.call('DELETE', '/me', {
      token: driver.token,
      body: { confirmation: 'ELIMINAR', password: PASSWORD },
    });
    expect(res.statusCode, res.body).toBe(204);

    expect(await prisma.driverDocument.count({ where: { driverId: driver.id } })).toBe(0);
    await expect(storage.get(storageKey)).rejects.toThrow();
    const profile = await prisma.driverProfile.findUniqueOrThrow({ where: { userId: driver.id } });
    expect(profile).toMatchObject({ status: 'SUSPENDED', licenseNumberEnc: '', licenseLast4: '' });
    // Ya no aparece como disponible.
    expect(await nearby()).toHaveLength(0);
  });
});

describe('retención de datos', () => {
  it('borra trazas viejas, IP de auditoría, sesiones y códigos caducados', async () => {
    const { trip } = await finishedTrip();
    const now = new Date();
    const old = new Date(now.getTime() - 91 * DAY);
    await prisma.tripRoutePoint.create({
      data: { tripId: trip.id, at: old, lat: 4.3, lng: -74.8 },
    });
    const audit = await prisma.auditLog.create({
      data: {
        actorId: null,
        action: 'test.old',
        entity: 'test',
        ip: '203.0.113.9',
        at: new Date(now.getTime() - 181 * DAY),
      },
    });
    const recentAudit = await prisma.auditLog.create({
      data: { actorId: null, action: 'test.recent', entity: 'test', ip: '203.0.113.10' },
    });
    const user = await register('PASSENGER');
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        familyId: randomUUID(),
        tokenHash: randomUUID(),
        expiresAt: new Date(now.getTime() - 8 * DAY),
      },
    });

    const result = await t.app.get(RetentionService).run(now);
    expect(result.routePoints).toBeGreaterThanOrEqual(1);
    expect(result.refreshTokens).toBeGreaterThanOrEqual(1);
    // Los puntos recientes del viaje siguen.
    expect(await prisma.tripRoutePoint.count({ where: { tripId: trip.id } })).toBe(2);
    expect((await prisma.auditLog.findUniqueOrThrow({ where: { id: audit.id } })).ip).toBeNull();
    expect((await prisma.auditLog.findUniqueOrThrow({ where: { id: recentAudit.id } })).ip).toBe(
      '203.0.113.10',
    );
    // La sesión vigente del usuario no se toca.
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(1);
  });
});
