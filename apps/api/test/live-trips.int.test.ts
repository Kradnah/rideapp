import { randomUUID } from 'node:crypto';
import {
  type AdminTripDetail,
  type DriverLocationV1,
  type LatLng,
  Trip,
  type TripDriverLocationResponse,
  type TripDriverLocationV1,
  type TripOfferV1,
  type TripStatusV1,
} from '@rideapp/contracts';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FieldCrypto } from '../src/common/crypto/field-crypto.js';
import { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { RedisService } from '../src/infra/redis/redis.service.js';
import { createAdmin } from '../src/modules/admin/admin-provisioning.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { TokenService } from '../src/modules/auth/token.service.js';
import {
  DEFAULT_LIVE_TRIP_TIMINGS,
  LIVE_TRIP_TIMINGS,
  LiveTripService,
} from '../src/modules/trips/live-trip.service.js';
import { MAX_PIN_ATTEMPTS } from '../src/modules/trips/trips.service.js';
import { type IntegrationApp, startIntegrationApp } from './helpers/int-app.js';
import { tripKit } from './helpers/trip-kit.js';

/**
 * Fase 4: viaje en vivo. Posición del conductor solo a la sala del viaje con ETA calculado en el
 * servidor, llegué / iniciar con PIN cerca del origen / finalizar, traza muestreada y panel.
 */

let t: IntegrationApp;
let prisma: PrismaService;
let redis: RedisService;
let adminToken: string;

beforeAll(async () => {
  t = await startIntegrationApp([
    {
      provide: LIVE_TRIP_TIMINGS,
      useValue: { ...DEFAULT_LIVE_TRIP_TIMINGS, sampleEveryMs: 200, flushEveryMs: 3600_000 },
    },
  ]);
  prisma = t.app.get(PrismaService);
  redis = t.app.get(RedisService);
  const admin = await createAdmin(
    { prisma, crypto: t.app.get(FieldCrypto), passwords: new PasswordService() },
    {
      email: `admin-${randomUUID()}@example.com`,
      fullName: 'Admin Demo',
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

const kit = tripKit(() => t);
const { sleep, register, approvedDriver, connected, next, status, collect, requestTrip, getTrip } =
  kit;

afterEach(async () => {
  kit.disconnectAll();
  await redis.client.del('geo:drivers:available:STANDARD', 'geo:drivers:available:MOTO');
  await prisma.trip.updateMany({
    where: { status: { in: ['REQUESTED', 'SEARCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVED'] } },
    data: { status: 'CANCELLED', cancelledBy: 'SYSTEM', cancelledAt: new Date() },
  });
});

afterAll(async () => {
  await t?.stop();
});

// ---------- utilidades ----------

/** ~1 km al norte de la recogida (el origen de los viajes de prueba, el centro de Girardot). */
const FAR: LatLng = { lat: 4.3125, lng: -74.8036 };
/** ~250 m al norte: basta para "Llegué" (300 m) pero no para iniciar (150 m). */
const NEAR_250: LatLng = { lat: 4.30575, lng: -74.8036 };
/** ~55 m de la recogida. */
const AT_PICKUP: LatLng = { lat: 4.304, lng: -74.8036 };

/**
 * Hora del GPS simulada: los tests mueven al conductor cientos de metros en un segundo real, así
 * que cada lectura avanza `seconds` en este reloj para que la velocidad sea creíble (el servidor
 * descarta > 200 km/h). Empieza 100 s atrás porque no admite lecturas del futuro.
 */
let gpsClock = 0;

/** Envía una posición respetando el límite de 1 mensaje por segundo del socket. */
async function moveTo(socket: Socket, at: LatLng, seconds = 8) {
  await sleep(950);
  gpsClock += seconds * 1000;
  const payload: DriverLocationV1 = { ...at, heading: 180, speed: 8, accuracy: 8, ts: gpsClock };
  return socket.timeout(3000).emitWithAck('driver.location.v1', payload) as Promise<{
    ok: boolean;
  }>;
}

/** Viaje con conductor asignado, que está en `driverAt`. */
async function assignedTrip(driverAt: LatLng) {
  const driver = await approvedDriver('Nora Conductora');
  expect((await t.call('POST', '/drivers/me/online', { token: driver.token })).statusCode).toBe(
    200,
  );
  const dSocket = await connected(driver.token);
  gpsClock = Date.now() - 100_000;
  expect(await moveTo(dSocket, driverAt)).toEqual({ ok: true });

  const passenger = await register('PASSENGER', 'Pía Pasajera');
  const pSocket = await connected(passenger.token);
  const offer = next<TripOfferV1>(dSocket, 'trip.offer.v1');
  const { trip } = await requestTrip(passenger.token);
  await offer;
  const accept = await t.call('POST', `/trips/${trip.id}/accept`, { token: driver.token });
  expect(accept.statusCode, accept.body).toBe(200);
  return {
    driver: { ...driver, socket: dSocket },
    passenger: { ...passenger, socket: pSocket },
    trip,
  };
}

const action = (token: string, tripId: string, name: string, body?: object, key?: string) =>
  t.call('POST', `/trips/${tripId}/${name}`, {
    token,
    body,
    ...(key && { headers: { 'idempotency-key': key } }),
  });

// ---------- viaje en vivo ----------

describe('viaje en vivo', () => {
  it('de punta a punta: posición con ETA, llegué, PIN, iniciar, finalizar y traza', async () => {
    const { driver, passenger, trip } = await assignedTrip(FAR);
    const stranger = await register('PASSENGER', 'Otra Persona');
    const strangerSees = collect<TripDriverLocationV1>(
      await connected(stranger.token),
      'trip.driverLocation.v1',
    );

    // La posición llega al pasajero con un ETA calculado en el servidor.
    const located = next<TripDriverLocationV1>(passenger.socket, 'trip.driverLocation.v1');
    expect(await moveTo(driver.socket, FAR)).toEqual({ ok: true });
    const first = await located;
    expect(first).toMatchObject({ tripId: trip.id, position: FAR, heading: 180 });
    // ~1 km a 25 km/h por la ruta aproximada: entre 1 y 5 minutos.
    expect(first.etaSeconds).toBeGreaterThan(60);
    expect(first.etaSeconds).toBeLessThan(300);

    // Al abrir la pantalla, el pasajero puede pedir la última posición; nadie más.
    const last = await t.call('GET', `/trips/${trip.id}/driver-location`, {
      token: passenger.token,
    });
    expect((last.json() as TripDriverLocationResponse).location).toMatchObject({
      position: FAR,
    });
    expect(
      (await t.call('GET', `/trips/${trip.id}/driver-location`, { token: stranger.token }))
        .statusCode,
    ).toBe(404);
    expect(
      (await t.call('GET', `/trips/${trip.id}/driver-location`, { token: driver.token }))
        .statusCode,
    ).toBe(403);

    // Lejos de la recogida no puede marcar "Llegué".
    const tooFar = await action(driver.token, trip.id, 'arrived');
    expect(tooFar.statusCode).toBe(409);
    expect(tooFar.json()).toMatchObject({ code: 'NOT_AT_PICKUP' });

    // Se acerca: el ETA baja.
    const closer = next<TripDriverLocationV1>(
      passenger.socket,
      'trip.driverLocation.v1',
      (e) => Math.abs(e.position.lat - NEAR_250.lat) < 1e-6,
    );
    expect(await moveTo(driver.socket, NEAR_250, 20)).toEqual({ ok: true });
    expect((await closer).etaSeconds).toBeLessThan(first.etaSeconds!);

    // Llegué: el pasajero se entera y deja de haber ETA.
    const arrivedEvent = next<TripStatusV1>(
      passenger.socket,
      'trip.status.v1',
      status('DRIVER_ARRIVED'),
    );
    const arrived = await action(driver.token, trip.id, 'arrived');
    expect(arrived.statusCode, arrived.body).toBe(200);
    expect(Trip.parse(arrived.json()).arrivedAt).not.toBeNull();
    await arrivedEvent;
    const waiting = next<TripDriverLocationV1>(passenger.socket, 'trip.driverLocation.v1');
    expect(await moveTo(driver.socket, NEAR_250)).toEqual({ ok: true });
    expect((await waiting).etaSeconds).toBeNull();

    // A 250 m todavía no puede iniciar; cerca sí, pero solo con el PIN correcto.
    const notYet = await action(driver.token, trip.id, 'start', { pin: trip.pin });
    expect(notYet.statusCode).toBe(409);
    expect(notYet.json()).toMatchObject({ code: 'NOT_AT_PICKUP' });
    expect(await moveTo(driver.socket, AT_PICKUP)).toEqual({ ok: true });
    const wrongPin = trip.pin === '0000' ? '1111' : '0000';
    const wrong = await action(driver.token, trip.id, 'start', { pin: wrongPin });
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json()).toMatchObject({ code: 'INVALID_PIN' });
    expect((await action(driver.token, trip.id, 'start', { pin: '12a4' })).statusCode).toBe(400);

    const startedEvent = next<TripStatusV1>(
      passenger.socket,
      'trip.status.v1',
      status('IN_PROGRESS'),
    );
    const started = await action(driver.token, trip.id, 'start', { pin: trip.pin });
    expect(started.statusCode, started.body).toBe(200);
    expect(Trip.parse(started.json())).toMatchObject({ status: 'IN_PROGRESS' });
    await startedEvent;

    // En viaje, el ETA es hasta el destino (la ruta cotizada, ~2 km).
    const riding = next<TripDriverLocationV1>(passenger.socket, 'trip.driverLocation.v1');
    expect(await moveTo(driver.socket, AT_PICKUP)).toEqual({ ok: true });
    const ride = await riding;
    expect(ride.etaSeconds).toBeGreaterThan(first.etaSeconds!);
    expect(await moveTo(driver.socket, { lat: 4.3, lng: -74.797 }, 30)).toEqual({ ok: true });

    // Panel: traza muestreada y posición en vivo.
    expect(await t.app.get(LiveTripService).flushRoutePoints()).toBeGreaterThanOrEqual(4);
    const detail = (
      await t.call('GET', `/admin/trips/${trip.id}`, { token: adminToken })
    ).json() as AdminTripDetail;
    expect(detail.trace.length).toBeGreaterThanOrEqual(4);
    expect(detail.trace[0]).toEqual(FAR);
    expect(detail.live).toMatchObject({ tripId: trip.id, position: { lat: 4.3, lng: -74.797 } });

    // Finalizar con Idempotency-Key: un reintento devuelve lo mismo, sin repetir la acción.
    const completedEvent = next<TripStatusV1>(
      passenger.socket,
      'trip.status.v1',
      status('COMPLETED'),
    );
    const key = randomUUID();
    const done = await action(driver.token, trip.id, 'complete', undefined, key);
    expect(done.statusCode, done.body).toBe(200);
    const completed = Trip.parse(done.json());
    expect(completed).toMatchObject({ status: 'COMPLETED', amount: trip.amount });
    expect(completed.completedAt).not.toBeNull();
    await completedEvent;
    const retry = await action(driver.token, trip.id, 'complete', undefined, key);
    expect(retry.statusCode).toBe(200);
    expect(Trip.parse(retry.json()).completedAt).toBe(completed.completedAt);
    expect((await action(driver.token, trip.id, 'complete')).statusCode).toBe(409);
    expect(
      await prisma.tripEvent.count({ where: { tripId: trip.id, toStatus: 'COMPLETED' } }),
    ).toBe(1);

    // Terminado: el conductor queda libre, su posición ya no se comparte y el viaje no es activo.
    expect((await t.call('GET', '/drivers/me', { token: driver.token })).json()).toMatchObject({
      availability: 'AVAILABLE',
    });
    const after = collect<TripDriverLocationV1>(passenger.socket, 'trip.driverLocation.v1');
    expect(await moveTo(driver.socket, { lat: 4.2995, lng: -74.796 })).toEqual({ ok: true });
    await sleep(300);
    expect(after).toEqual([]);
    expect(
      (
        (
          await t.call('GET', `/trips/${trip.id}/driver-location`, { token: passenger.token })
        ).json() as TripDriverLocationResponse
      ).location,
    ).toBeNull();
    expect((await t.call('GET', '/trips/active', { token: passenger.token })).json()).toEqual({
      trip: null,
    });
    const adminAfter = (
      await t.call('GET', `/admin/trips/${trip.id}`, { token: adminToken })
    ).json() as AdminTripDetail;
    expect(adminAfter.live).toBeNull();
    expect(adminAfter.events.map((e) => e.toStatus)).toEqual([
      'REQUESTED',
      'SEARCHING',
      'DRIVER_ASSIGNED',
      'DRIVER_ARRIVED',
      'IN_PROGRESS',
      'COMPLETED',
    ]);

    // Nadie más vio la posición del conductor (14.4).
    expect(strangerSees).toEqual([]);
  }, 30_000);

  it('PIN: tras varios intentos fallidos se bloquea, aunque luego llegue el correcto', async () => {
    const { driver, trip } = await assignedTrip(AT_PICKUP);
    expect((await action(driver.token, trip.id, 'arrived')).statusCode).toBe(200);
    const wrongPin = trip.pin === '0000' ? '1111' : '0000';
    for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) {
      expect((await action(driver.token, trip.id, 'start', { pin: wrongPin })).statusCode).toBe(
        422,
      );
    }
    const blocked = await action(driver.token, trip.id, 'start', { pin: trip.pin! });
    expect(blocked.statusCode).toBe(429);
    expect((await getTrip(driver.token, trip.id)).trip?.status).toBe('DRIVER_ARRIVED');
  });

  it('solo el conductor asignado y en el orden de la máquina de estados', async () => {
    const { driver, passenger, trip } = await assignedTrip(AT_PICKUP);
    const other = await approvedDriver('Otro Conductor');

    // Otro conductor: como si no existiera. El pasajero: no tiene ese rol.
    expect((await action(other.token, trip.id, 'arrived')).statusCode).toBe(404);
    expect((await action(passenger.token, trip.id, 'arrived')).statusCode).toBe(403);
    expect((await action(passenger.token, trip.id, 'start', { pin: trip.pin! })).statusCode).toBe(
      403,
    );

    // Fuera de orden: iniciar o finalizar antes de llegar.
    expect((await action(driver.token, trip.id, 'start', { pin: trip.pin! })).statusCode).toBe(409);
    expect((await action(driver.token, trip.id, 'complete')).statusCode).toBe(409);
    expect((await action(driver.token, trip.id, 'arrived')).statusCode).toBe(200);
    expect((await action(driver.token, trip.id, 'arrived')).statusCode).toBe(409);

    // Ya en la recogida, el pasajero no aparece: el conductor cancela y queda libre.
    const cancelled = next<TripStatusV1>(passenger.socket, 'trip.status.v1', status('CANCELLED'));
    const cancel = await action(driver.token, trip.id, 'cancel', { reason: 'No se presentó' });
    expect(cancel.statusCode, cancel.body).toBe(200);
    expect(await cancelled).toMatchObject({ cancelledBy: 'DRIVER' });
    expect((await t.call('GET', '/drivers/me', { token: driver.token })).json()).toMatchObject({
      availability: 'AVAILABLE',
    });
    expect(await redis.client.exists(`trip:${trip.id}:eta`, `trip:${trip.id}:live`)).toBe(0);
  });
});
