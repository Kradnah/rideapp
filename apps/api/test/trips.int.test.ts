import { randomUUID } from 'node:crypto';
import {
  type AdminOverview,
  type AdminTripDetail,
  type AdminTripList,
  type AutocompleteResponse,
  computeFare,
  CURRENT_POLICY_VERSION,
  decodePolyline,
  type DriverLocationV1,
  type DriverOfferResponse,
  GIRARDOT_CENTER,
  type LatLng,
  type NearbyDriversResponse,
  type PlaceDetails,
  type QuoteResponse,
  type ReverseGeocodeResponse,
  Trip,
  type TripOfferCancelledV1,
  type TripOfferV1,
  TokenPair,
  type TripStatusV1,
  type VehicleCategory,
} from '@rideapp/contracts';
import { DEMO_FARE_RULES } from '@rideapp/contracts/fixtures';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FieldCrypto } from '../src/common/crypto/field-crypto.js';
import { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { RedisService } from '../src/infra/redis/redis.service.js';
import { createAdmin } from '../src/modules/admin/admin-provisioning.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { TokenService } from '../src/modules/auth/token.service.js';
import { colombiaDay, DAILY_USER_LIMITS } from '../src/modules/geo/geo.service.js';
import {
  DEFAULT_MATCHING_TIMINGS,
  MATCHING_TIMINGS,
  type MatchingTimings,
} from '../src/modules/trips/matching.service.js';
import { type IntegrationApp, startIntegrationApp } from './helpers/int-app.js';

/**
 * Fase 3: mapas (proxy), cotización, pedir un viaje y emparejamiento con ofertas a conductores.
 * Postgres/PostGIS y Redis reales; los tiempos del emparejamiento se acortan para no esperar.
 */

const TIMINGS: MatchingTimings = {
  ...DEFAULT_MATCHING_TIMINGS,
  offerTtlMs: 1_500,
  graceMs: 300,
  searchTimeoutMs: 5_000,
  retryDelayMs: 200,
  radiusStepMs: 2_000,
};

let t: IntegrationApp;
let prisma: PrismaService;
let redis: RedisService;
let adminToken: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  t = await startIntegrationApp([{ provide: MATCHING_TIMINGS, useValue: TIMINGS }]);
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

afterEach(async () => {
  for (const s of sockets.splice(0)) s.disconnect();
  // Cada test empieza sin conductores libres ni búsquedas abiertas de los anteriores.
  await redis.client.del('geo:drivers:available:STANDARD', 'geo:drivers:available:MOTO');
  await prisma.trip.updateMany({
    where: { status: { in: ['REQUESTED', 'SEARCHING'] } },
    data: { status: 'CANCELLED', cancelledBy: 'SYSTEM', cancelledAt: new Date() },
  });
});

afterAll(async () => {
  await t?.stop();
});

// ---------- utilidades ----------

const consent = { acceptTerms: true, policyVersion: CURRENT_POLICY_VERSION };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Destino de prueba: Unicentro, ~2 km al sureste del centro de Girardot. */
const UNICENTRO: LatLng = { lat: 4.2955, lng: -74.788 };
const BOGOTA: LatLng = { lat: 4.711, lng: -74.0721 };

async function register(role: 'DRIVER' | 'PASSENGER', fullName?: string) {
  const res = await t.call('POST', '/auth/register', {
    body: {
      email: `${role.toLowerCase()}-${randomUUID()}@example.com`,
      password: 'caballo-azul-girardot',
      fullName: fullName ?? (role === 'DRIVER' ? 'Carlos Conductor' : 'Pía Pasajera'),
      role,
      consent,
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  const tokens = TokenPair.parse(res.json());
  const id = JSON.parse(Buffer.from(tokens.accessToken.split('.')[1]!, 'base64url').toString())
    .sub as string;
  return { id, token: tokens.accessToken };
}

const randomPlate = () => {
  const L = () => String.fromCharCode(65 + Math.floor(Math.random() * 26));
  return `${L()}${L()}${L()}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
};

/** Conductor aprobado con vehículo activo (el flujo de aprobación se prueba en drivers.int). */
async function approvedDriver(
  fullName = 'Carlos Conductor',
  category: VehicleCategory = 'STANDARD',
) {
  const driver = await register('DRIVER', fullName);
  await prisma.driverProfile.create({
    data: {
      userId: driver.id,
      status: 'APPROVED',
      licenseNumberEnc: 'no-se-usa-en-estos-tests',
      licenseLast4: '3456',
      submittedAt: new Date(),
      approvedAt: new Date(),
      vehicles: {
        create: {
          plate: category === 'MOTO' ? 'ABC12D' : randomPlate(),
          brand: 'Chevrolet',
          model: 'Spark',
          color: 'Blanco',
          year: 2019,
          category,
          active: true,
        },
      },
    },
  });
  return driver;
}

async function connected(token: string): Promise<Socket> {
  const socket = connect(t.url, {
    transports: ['websocket'],
    reconnection: false,
    auth: { token },
  });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}

function sendLocation(socket: Socket, at: LatLng) {
  const payload: DriverLocationV1 = {
    ...at,
    heading: 90,
    speed: 0,
    accuracy: 8,
    ts: Date.now(),
  };
  return socket.timeout(3000).emitWithAck('driver.location.v1', payload) as Promise<{
    ok: boolean;
  }>;
}

/** Conductor aprobado, en línea, con socket y ubicación enviada. */
async function onlineDriverAt(at: LatLng, fullName?: string) {
  const driver = await approvedDriver(fullName);
  const online = await t.call('POST', '/drivers/me/online', { token: driver.token });
  expect(online.statusCode, online.body).toBe(200);
  const socket = await connected(driver.token);
  expect(await sendLocation(socket, at)).toEqual({ ok: true });
  return { ...driver, socket };
}

/** Espera el próximo evento que cumpla `match` (o falla a los `ms`). */
function next<T>(
  socket: Socket,
  event: string,
  match: (payload: T) => boolean = () => true,
  ms = 6_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Sin evento ${event} en ${ms} ms`));
    }, ms);
    const handler = (payload: T) => {
      if (!match(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

const status =
  (wanted: TripStatusV1['status']) =>
  (e: TripStatusV1): boolean =>
    e.status === wanted;

/** Acumula los eventos recibidos, para comprobar que algo NO llegó. */
function collect<T>(socket: Socket, event: string): T[] {
  const seen: T[] = [];
  socket.on(event, (p: T) => seen.push(p));
  return seen;
}

async function quote(token: string, origin = GIRARDOT_CENTER, destination = UNICENTRO) {
  const res = await t.call('POST', '/trips/quote', {
    token,
    body: {
      origin,
      destination,
      originAddress: 'Parque Bolívar',
      destinationAddress: 'Centro Comercial Unicentro',
      destinationPlaceId: 'fake-unicentro',
    },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as QuoteResponse;
}

async function requestTrip(
  token: string,
  key = randomUUID(),
  category: VehicleCategory = 'STANDARD',
) {
  const q = await quote(token);
  const quoteId = q.options.find((o) => o.category === category)!.quoteId;
  const res = await t.call('POST', '/trips', {
    token,
    body: { quoteId, paymentMethod: 'CASH' },
    headers: { 'idempotency-key': key },
  });
  expect(res.statusCode, res.body).toBe(201);
  return { trip: Trip.parse(res.json()), quoteId };
}

const getTrip = async (token: string, id: string) => {
  const res = await t.call('GET', `/trips/${id}`, { token });
  return { status: res.statusCode, trip: res.statusCode === 200 ? Trip.parse(res.json()) : null };
};

// ---------- mapas ----------

describe('geo (proxy de mapas)', () => {
  it('autocompletar, detalle y dirección de un punto, solo para pasajeros', async () => {
    const passenger = await register('PASSENGER');
    const driver = await register('DRIVER');
    const sessionToken = randomUUID();

    const ac = await t.call(
      'GET',
      `/geo/autocomplete?q=${encodeURIComponent('unicen')}&sessionToken=${sessionToken}`,
      { token: passenger.token },
    );
    expect(ac.statusCode, ac.body).toBe(200);
    const [first] = (ac.json() as AutocompleteResponse).suggestions;
    expect(first).toMatchObject({
      placeId: 'fake-unicentro',
      primaryText: 'Centro Comercial Unicentro',
    });

    const place = await t.call('GET', `/geo/place/${first!.placeId}?sessionToken=${sessionToken}`, {
      token: passenger.token,
    });
    expect(place.statusCode).toBe(200);
    expect((place.json() as PlaceDetails).location).toEqual(UNICENTRO);

    const reverse = await t.call('GET', '/geo/reverse?lat=4.3036&lng=-74.803', {
      token: passenger.token,
    });
    expect((reverse.json() as ReverseGeocodeResponse).formattedAddress).toContain('Parque Bolívar');

    // Validación, zona de servicio, lugar inexistente y rol.
    expect(
      (
        await t.call('GET', `/geo/autocomplete?q=ab&sessionToken=${sessionToken}`, {
          token: passenger.token,
        })
      ).statusCode,
    ).toBe(400);
    const outside = await t.call('GET', `/geo/reverse?lat=${BOGOTA.lat}&lng=${BOGOTA.lng}`, {
      token: passenger.token,
    });
    expect(outside.statusCode).toBe(422);
    expect(outside.json()).toMatchObject({ code: 'OUT_OF_SERVICE_AREA' });
    expect(
      (
        await t.call('GET', `/geo/place/fake-no-existe?sessionToken=${sessionToken}`, {
          token: passenger.token,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await t.call('GET', `/geo/place/..%2F..%2Fx?sessionToken=${sessionToken}`, {
          token: passenger.token,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await t.call('GET', `/geo/autocomplete?q=parque&sessionToken=${sessionToken}`, {
          token: driver.token,
        })
      ).statusCode,
    ).toBe(403);
  });

  it('límite diario por usuario (lo que sale de la caché no cuenta)', async () => {
    const passenger = await register('PASSENGER');
    const key = `quota:maps:autocomplete:${passenger.id}:${colombiaDay()}`;
    await redis.client.set(key, DAILY_USER_LIMITS.autocomplete);
    const res = await t.call('GET', `/geo/autocomplete?q=parque&sessionToken=${randomUUID()}`, {
      token: passenger.token,
    });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ code: 'RATE_LIMITED' });

    // El mismo punto otra vez sale de la caché y no gasta cupo.
    const other = await register('PASSENGER');
    await t.call('GET', '/geo/reverse?lat=4.29811&lng=-74.79801', { token: other.token });
    await t.call('GET', '/geo/reverse?lat=4.29812&lng=-74.79802', { token: other.token });
    expect(await redis.client.get(`quota:maps:reverse:${other.id}:${colombiaDay()}`)).toBe('1');
  });
});

// ---------- cotización ----------

describe('cotización', () => {
  it('una ruta, una opción por categoría, precio calculado en el servidor', async () => {
    const passenger = await register('PASSENGER');
    const q = await quote(passenger.token);
    expect(q.options.map((o) => o.category)).toEqual(['STANDARD', 'MOTO']);
    for (const option of q.options) {
      expect(option.amount).toEqual({
        amountCents: computeFare(
          DEMO_FARE_RULES[option.category],
          q.distanceMeters,
          q.durationSeconds,
        ),
        currency: 'COP',
      });
      expect(option.amount.amountCents % 10_000).toBe(0);
    }
    expect(decodePolyline(q.polyline)).toHaveLength(2);
    const ttl = new Date(q.expiresAt).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(4 * 60_000);
    expect(ttl).toBeLessThanOrEqual(5 * 60_000);
  });

  it('fuera de zona, demasiado cerca, campos de más o sin rol de pasajero', async () => {
    const passenger = await register('PASSENGER');
    const driver = await register('DRIVER');
    const body = (origin: LatLng, destination: LatLng, extra = {}) => ({
      origin,
      destination,
      ...extra,
    });
    const outside = await t.call('POST', '/trips/quote', {
      token: passenger.token,
      body: body(GIRARDOT_CENTER, BOGOTA),
    });
    expect(outside.statusCode).toBe(422);
    expect(outside.json()).toMatchObject({ code: 'OUT_OF_SERVICE_AREA' });
    expect(
      (
        await t.call('POST', '/trips/quote', {
          token: passenger.token,
          body: body(GIRARDOT_CENTER, {
            lat: GIRARDOT_CENTER.lat + 0.0001,
            lng: GIRARDOT_CENTER.lng,
          }),
        })
      ).statusCode,
    ).toBe(422);
    // El precio nunca lo manda el cliente.
    expect(
      (
        await t.call('POST', '/trips/quote', {
          token: passenger.token,
          body: body(GIRARDOT_CENTER, UNICENTRO, { amountCents: 1 }),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await t.call('POST', '/trips/quote', {
          token: driver.token,
          body: body(GIRARDOT_CENTER, UNICENTRO),
        })
      ).statusCode,
    ).toBe(403);
  });
});

// ---------- pedir un viaje ----------

describe('pedir un viaje', () => {
  it('crea el viaje buscando conductor, es idempotente y solo hay uno activo', async () => {
    const passenger = await register('PASSENGER');
    const key = randomUUID();
    const { trip, quoteId } = await requestTrip(passenger.token, key);
    expect(trip).toMatchObject({
      status: 'SEARCHING',
      category: 'STANDARD',
      paymentMethod: 'CASH',
      originAddress: 'Parque Bolívar',
      destinationAddress: 'Centro Comercial Unicentro',
      driver: null,
      passenger: null,
    });
    expect(trip.pin).toMatch(/^\d{4}$/);

    // Reintento con la misma clave: el mismo viaje, sin duplicar.
    const retry = await t.call('POST', '/trips', {
      token: passenger.token,
      body: { quoteId, paymentMethod: 'CASH' },
      headers: { 'idempotency-key': key },
    });
    expect(retry.statusCode).toBe(201);
    expect(Trip.parse(retry.json()).id).toBe(trip.id);
    expect(await prisma.trip.count({ where: { passengerId: passenger.id } })).toBe(1);

    // Otra solicitud mientras hay uno activo.
    const q2 = await quote(passenger.token);
    const second = await t.call('POST', '/trips', {
      token: passenger.token,
      body: { quoteId: q2.options[0]!.quoteId, paymentMethod: 'CASH' },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ code: 'ACTIVE_TRIP_EXISTS' });

    const active = await t.call('GET', '/trips/active', { token: passenger.token });
    expect(active.json()).toMatchObject({ trip: { id: trip.id } });

    // Cancelar y no poder reutilizar la cotización.
    const cancel = await t.call('POST', `/trips/${trip.id}/cancel`, {
      token: passenger.token,
      body: { reason: 'Me equivoqué de destino' },
    });
    expect(cancel.statusCode, cancel.body).toBe(200);
    expect(Trip.parse(cancel.json())).toMatchObject({
      status: 'CANCELLED',
      cancelledBy: 'PASSENGER',
      cancelReason: 'Me equivoqué de destino',
    });
    const reuse = await t.call('POST', '/trips', {
      token: passenger.token,
      body: { quoteId, paymentMethod: 'CASH' },
    });
    expect(reuse.statusCode).toBe(409);
    expect(reuse.json()).toMatchObject({ code: 'CONFLICT' });
    expect((await t.call('GET', '/trips/active', { token: passenger.token })).json()).toEqual({
      trip: null,
    });
  });

  it('cotización ajena, caducada o cabecera de idempotencia inválida', async () => {
    const owner = await register('PASSENGER');
    const other = await register('PASSENGER');
    const q = await quote(owner.token);
    const quoteId = q.options[0]!.quoteId;

    const foreign = await t.call('POST', '/trips', {
      token: other.token,
      body: { quoteId, paymentMethod: 'CASH' },
    });
    expect(foreign.statusCode).toBe(404);

    expect(
      (
        await t.call('POST', '/trips', {
          token: owner.token,
          body: { quoteId, paymentMethod: 'CASH' },
          headers: { 'idempotency-key': 'corta' },
        })
      ).statusCode,
    ).toBe(400);

    await prisma.fareQuote.update({
      where: { id: quoteId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await t.call('POST', '/trips', {
      token: owner.token,
      body: { quoteId, paymentMethod: 'CASH' },
    });
    expect(expired.statusCode).toBe(409);
    expect(expired.json()).toMatchObject({ code: 'QUOTE_EXPIRED' });
  });

  it('nadie más puede ver ni cancelar el viaje (IDOR)', async () => {
    const owner = await register('PASSENGER');
    const other = await register('PASSENGER');
    const driver = await approvedDriver();
    const { trip } = await requestTrip(owner.token);

    expect((await getTrip(other.token, trip.id)).status).toBe(404);
    expect((await getTrip(driver.token, trip.id)).status).toBe(404);
    expect(
      (await t.call('POST', `/trips/${trip.id}/cancel`, { token: other.token, body: {} }))
        .statusCode,
    ).toBe(404);
    expect(
      (await t.call('POST', `/trips/${trip.id}/accept`, { token: driver.token })).statusCode,
    ).toBe(409);
    expect((await getTrip(owner.token, trip.id)).trip?.status).toBe('SEARCHING');
  });

  it('sin conductores cerca: NO_DRIVERS al agotar el tiempo, con aviso por el socket', async () => {
    const passenger = await register('PASSENGER');
    const socket = await connected(passenger.token);
    const searching = next<TripStatusV1>(socket, 'trip.status.v1', status('SEARCHING'));
    const noDrivers = next<TripStatusV1>(
      socket,
      'trip.status.v1',
      status('NO_DRIVERS'),
      TIMINGS.searchTimeoutMs + 4000,
    );
    const { trip } = await requestTrip(passenger.token);

    expect(await searching).toMatchObject({ tripId: trip.id, previousStatus: 'REQUESTED' });
    expect(await noDrivers).toMatchObject({ tripId: trip.id, previousStatus: 'SEARCHING' });
    expect((await getTrip(passenger.token, trip.id)).trip?.status).toBe('NO_DRIVERS');
    // Puede volver a pedir.
    await requestTrip(passenger.token);
  }, 20_000);
});

// ---------- emparejamiento ----------

describe('emparejamiento', () => {
  it('oferta al más cercano, aceptar, y cada parte ve solo lo que le toca', async () => {
    const near = await onlineDriverAt({ lat: 4.3045, lng: -74.8036 }, 'Nora Cercana');
    const far = await onlineDriverAt({ lat: 4.315, lng: -74.8036 }, 'Felipe Lejano');
    const farOffers = collect<TripOfferV1>(far.socket, 'trip.offer.v1');
    const passenger = await register('PASSENGER', 'Pía Pasajera');
    const pSocket = await connected(passenger.token);
    const statuses = collect<TripStatusV1>(pSocket, 'trip.status.v1');

    const offerPromise = next<TripOfferV1>(near.socket, 'trip.offer.v1');
    const { trip } = await requestTrip(passenger.token);
    const offer = await offerPromise;
    expect(offer).toMatchObject({
      tripId: trip.id,
      pickupArea: 'Girardot',
      destinationArea: 'Girardot',
      amount: trip.amount,
      paymentMethod: 'CASH',
    });
    expect(offer.pickupDistanceMeters).toBeGreaterThan(50);
    expect(offer.pickupDistanceMeters).toBeLessThan(200);
    // La oferta no lleva direcciones exactas ni datos del pasajero (14.4).
    const raw = JSON.stringify(offer);
    for (const secret of ['Parque Bolívar', 'Unicentro', 'Pía', passenger.id]) {
      expect(raw).not.toContain(secret);
    }
    // Antes de aceptar, el conductor no puede ver el viaje.
    expect((await getTrip(near.token, trip.id)).status).toBe(404);
    // La app puede recuperar la oferta si perdió el evento.
    const pending = await t.call('GET', '/drivers/me/offer', { token: near.token });
    expect((pending.json() as DriverOfferResponse).offer).toEqual(offer);

    const assigned = next<TripStatusV1>(pSocket, 'trip.status.v1', status('DRIVER_ASSIGNED'));
    const accept = await t.call('POST', `/trips/${trip.id}/accept`, { token: near.token });
    expect(accept.statusCode, accept.body).toBe(200);
    const driverView = Trip.parse(accept.json());
    expect(driverView).toMatchObject({
      status: 'DRIVER_ASSIGNED',
      pin: null,
      passenger: { fullName: 'Pía Pasajera' },
      originAddress: 'Parque Bolívar',
      driver: null,
    });
    expect(await assigned).toMatchObject({ tripId: trip.id, status: 'DRIVER_ASSIGNED' });
    expect(statuses.map((s) => s.status)).toContain('DRIVER_ASSIGNED');

    const passengerView = (await getTrip(passenger.token, trip.id)).trip!;
    expect(passengerView).toMatchObject({
      status: 'DRIVER_ASSIGNED',
      pin: trip.pin,
      passenger: null,
      driver: {
        fullName: 'Nora Cercana',
        vehicle: { brand: 'Chevrolet', model: 'Spark', color: 'Blanco', category: 'STANDARD' },
      },
    });

    // El conductor queda ocupado: no aparece cerca, no se desconecta y retoma el viaje.
    const nearby = (
      await t.call('GET', '/drivers/nearby?lat=4.3045&lng=-74.8036', { token: passenger.token })
    ).json() as NearbyDriversResponse;
    expect(nearby.drivers.some((d) => Math.abs(d.position.lat - 4.3045) < 0.0006)).toBe(false);
    const offline = await t.call('POST', '/drivers/me/offline', { token: near.token });
    expect(offline.statusCode).toBe(409);
    expect(offline.json()).toMatchObject({ code: 'ACTIVE_TRIP_EXISTS' });
    expect((await t.call('GET', '/trips/active', { token: near.token })).json()).toMatchObject({
      trip: { id: trip.id, status: 'DRIVER_ASSIGNED' },
    });
    expect((await t.call('GET', '/drivers/me', { token: near.token })).json()).toMatchObject({
      availability: 'BUSY',
    });
    expect(farOffers).toEqual([]);

    // El pasajero cancela: el conductor se entera por la sala del viaje y vuelve a estar libre.
    const driverSees = next<TripStatusV1>(near.socket, 'trip.status.v1', status('CANCELLED'));
    const cancel = await t.call('POST', `/trips/${trip.id}/cancel`, {
      token: passenger.token,
      body: {},
    });
    expect(cancel.statusCode, cancel.body).toBe(200);
    expect(await driverSees).toMatchObject({ status: 'CANCELLED', cancelledBy: 'PASSENGER' });
    expect((await t.call('GET', '/drivers/me', { token: near.token })).json()).toMatchObject({
      availability: 'AVAILABLE',
    });
  });

  it('rechazar o dejar caducar la oferta pasa al siguiente conductor', async () => {
    const first = await onlineDriverAt({ lat: 4.304, lng: -74.8036 });
    const second = await onlineDriverAt({ lat: 4.306, lng: -74.8036 });
    const third = await onlineDriverAt({ lat: 4.309, lng: -74.8036 });
    const passenger = await register('PASSENGER');

    const firstOffer = next<TripOfferV1>(first.socket, 'trip.offer.v1');
    const { trip } = await requestTrip(passenger.token);
    await firstOffer;

    // El primero rechaza → el segundo recibe la oferta al instante.
    const secondOffer = next<TripOfferV1>(second.socket, 'trip.offer.v1');
    const reject = await t.call('POST', `/trips/${trip.id}/reject`, { token: first.token });
    expect(reject.statusCode, reject.body).toBe(204);
    expect((await secondOffer).tripId).toBe(trip.id);
    // Ya no puede aceptar lo que rechazó.
    expect(
      (await t.call('POST', `/trips/${trip.id}/accept`, { token: first.token })).statusCode,
    ).toBe(409);

    // El segundo no responde → caduca, se le avisa y pasa al tercero.
    const expired = next<TripOfferCancelledV1>(second.socket, 'trip.offerCancelled.v1');
    const thirdOffer = next<TripOfferV1>(third.socket, 'trip.offer.v1');
    expect(await expired).toEqual({ tripId: trip.id, reason: 'EXPIRED' });
    expect((await thirdOffer).tripId).toBe(trip.id);
    expect((await t.call('GET', '/drivers/me/offer', { token: second.token })).json()).toEqual({
      offer: null,
    });

    const accept = await t.call('POST', `/trips/${trip.id}/accept`, { token: third.token });
    expect(accept.statusCode, accept.body).toBe(200);

    const detail = (
      await t.call('GET', `/admin/trips/${trip.id}`, { token: adminToken })
    ).json() as AdminTripDetail;
    expect(detail.offersDeclined).toBe(2);
  }, 20_000);

  it('aceptar a la vez: solo uno gana', async () => {
    const offered = await onlineDriverAt({ lat: 4.3042, lng: -74.8036 });
    const other = await onlineDriverAt({ lat: 4.3062, lng: -74.8036 });
    const passenger = await register('PASSENGER');

    const offer = next<TripOfferV1>(offered.socket, 'trip.offer.v1');
    const { trip } = await requestTrip(passenger.token);
    await offer;

    const results = await Promise.all([
      t.call('POST', `/trips/${trip.id}/accept`, { token: offered.token }),
      t.call('POST', `/trips/${trip.id}/accept`, { token: offered.token }),
      t.call('POST', `/trips/${trip.id}/accept`, { token: other.token }),
    ]);
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([200, 409, 409]);
    const final = await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } });
    expect(final).toMatchObject({ status: 'DRIVER_ASSIGNED', driverId: offered.id });
    expect(
      await prisma.tripEvent.count({ where: { tripId: trip.id, toStatus: 'DRIVER_ASSIGNED' } }),
    ).toBe(1);
  });

  it('cancelar mientras hay una oferta: se retira y el conductor queda libre para otra', async () => {
    const driver = await onlineDriverAt({ lat: 4.3042, lng: -74.8036 });
    const p1 = await register('PASSENGER');
    const p2 = await register('PASSENGER');

    const offer = next<TripOfferV1>(driver.socket, 'trip.offer.v1');
    const { trip } = await requestTrip(p1.token);
    await offer;

    const withdrawn = next<TripOfferCancelledV1>(driver.socket, 'trip.offerCancelled.v1');
    await t.call('POST', `/trips/${trip.id}/cancel`, { token: p1.token, body: {} });
    expect(await withdrawn).toEqual({ tripId: trip.id, reason: 'CANCELLED' });

    // Sin esperar a que caduque la reserva, recibe la siguiente solicitud.
    const nextOffer = next<TripOfferV1>(driver.socket, 'trip.offer.v1');
    const { trip: trip2 } = await requestTrip(p2.token);
    expect((await nextOffer).tripId).toBe(trip2.id);
  });

  it('el socket del conductor retoma la sala de su viaje al reconectar', async () => {
    const driver = await onlineDriverAt({ lat: 4.3042, lng: -74.8036 });
    const passenger = await register('PASSENGER');
    const offer = next<TripOfferV1>(driver.socket, 'trip.offer.v1');
    const { trip } = await requestTrip(passenger.token);
    await offer;
    await t.call('POST', `/trips/${trip.id}/accept`, { token: driver.token });

    driver.socket.disconnect();
    const again = await connected(driver.token);
    await sleep(300);
    const seen = next<TripStatusV1>(again, 'trip.status.v1', status('CANCELLED'));
    await t.call('POST', `/trips/${trip.id}/cancel`, { token: passenger.token, body: {} });
    expect(await seen).toMatchObject({ tripId: trip.id, status: 'CANCELLED' });
  });
});

// ---------- panel ----------

describe('panel: viajes', () => {
  it('listado con filtros, detalle con la línea de tiempo y resumen del día', async () => {
    const passenger = await register('PASSENGER', 'Pía Panel');
    const { trip } = await requestTrip(passenger.token);
    await t.call('POST', `/trips/${trip.id}/cancel`, { token: passenger.token, body: {} });

    const finished = (
      await t.call('GET', '/admin/trips?status=FINISHED', { token: adminToken })
    ).json() as AdminTripList;
    expect(finished.items.find((i) => i.id === trip.id)).toMatchObject({
      status: 'CANCELLED',
      passengerName: 'Pía Panel',
      driverName: null,
    });
    const active = (
      await t.call('GET', '/admin/trips?status=ACTIVE', { token: adminToken })
    ).json() as AdminTripList;
    expect(active.items.some((i) => i.id === trip.id)).toBe(false);

    const page = (
      await t.call('GET', '/admin/trips?limit=1', { token: adminToken })
    ).json() as AdminTripList;
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();

    const detail = await t.call('GET', `/admin/trips/${trip.id}`, { token: adminToken });
    expect(detail.statusCode).toBe(200);
    const body = detail.json() as AdminTripDetail & { pin?: string };
    expect(body.pin).toBeUndefined();
    expect(body.events.map((e) => [e.fromStatus, e.toStatus, e.actor])).toEqual([
      [null, 'REQUESTED', 'PASSENGER'],
      ['REQUESTED', 'SEARCHING', 'SYSTEM'],
      ['SEARCHING', 'CANCELLED', 'PASSENGER'],
    ]);

    const overview = (
      await t.call('GET', '/admin/overview', { token: adminToken })
    ).json() as AdminOverview;
    expect(overview.trips.today).toBeGreaterThanOrEqual(1);
    expect(overview.maps.provider).toBe('fake');
    expect(overview.maps.callsToday['route']).toBeGreaterThanOrEqual(1);

    // Solo el panel con segundo factor.
    expect((await t.call('GET', '/admin/trips', { token: passenger.token })).statusCode).toBe(403);
  });
});
