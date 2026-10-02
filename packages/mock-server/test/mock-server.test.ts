import type { AddressInfo } from 'node:net';
import {
  CURRENT_POLICY_VERSION,
  ApiError,
  AutocompleteResponse,
  Me,
  NearbyDriversResponse,
  QuoteResponse,
  TokenPair,
  TripDriverLocationV1,
} from '@rideapp/contracts';
import { DEMO_DRIVER_ROUTE } from '@rideapp/contracts/fixtures';
import { io as connect } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMockServer, DEMO_TRIP_ID } from '../src/app.js';
import { RouteWalker } from '../src/simulator.js';

let mock: ReturnType<typeof buildMockServer>;

beforeEach(async () => {
  mock = buildMockServer({ simulatorIntervalMs: 0 });
  await mock.app.ready();
});

afterEach(async () => {
  await mock.app.close();
});

async function register() {
  const res = await mock.app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      email: 'ana@example.com',
      password: 'una-clave-larga',
      fullName: 'Ana',
      role: 'PASSENGER',
      consent: { acceptTerms: true, policyVersion: CURRENT_POLICY_VERSION },
    },
  });
  expect(res.statusCode).toBe(201);
  return TokenPair.parse(res.json());
}

describe('auth', () => {
  it('registro → /me', async () => {
    const tokens = await register();
    const me = await mock.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(Me.parse(me.json()).email).toBe('ana@example.com');
  });

  it('rechaza el registro como ADMIN con ApiError', async () => {
    const res = await mock.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'x@example.com',
        password: 'una-clave-larga',
        fullName: 'X',
        role: 'ADMIN',
        consent: { acceptTerms: true, policyVersion: CURRENT_POLICY_VERSION },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(ApiError.parse(res.json()).code).toBe('VALIDATION_FAILED');
  });

  it('login con contraseña incorrecta da error genérico', async () => {
    await register();
    const res = await mock.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ana@example.com', password: 'otra-cosa' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('sin token responde 401', async () => {
    const res = await mock.app.inject({ method: 'GET', url: '/api/me' });
    expect(res.statusCode).toBe(401);
  });
});

describe('geo y tarifas', () => {
  it('autocompleta lugares de Girardot', async () => {
    const { accessToken } = await register();
    const res = await mock.app.inject({
      method: 'GET',
      url: '/api/geo/autocomplete',
      query: { q: 'parque', sessionToken: crypto.randomUUID() },
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(AutocompleteResponse.parse(res.json()).suggestions.length).toBeGreaterThan(0);
  });

  it('cotiza un viaje dentro de la zona', async () => {
    const { accessToken } = await register();
    const res = await mock.app.inject({
      method: 'POST',
      url: '/api/trips/quote',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        origin: { lat: 4.3036, lng: -74.803 },
        destination: { lat: 4.2955, lng: -74.788 },
        category: 'STANDARD',
      },
    });
    const quote = QuoteResponse.parse(res.json());
    expect(quote.amount.amountCents % 10_000).toBe(0);
  });

  it('rechaza cotizaciones fuera de zona', async () => {
    const { accessToken } = await register();
    const res = await mock.app.inject({
      method: 'POST',
      url: '/api/trips/quote',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        origin: { lat: 4.3036, lng: -74.803 },
        destination: { lat: 4.711, lng: -74.0721 },
        category: 'STANDARD',
      },
    });
    expect(res.statusCode).toBe(422);
  });

  it('conductores cercanos sin IDs', async () => {
    const { accessToken } = await register();
    const res = await mock.app.inject({
      method: 'GET',
      url: '/api/drivers/nearby',
      query: { lat: '4.3', lng: '-74.8' },
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const body = NearbyDriversResponse.parse(res.json());
    expect(body.drivers.length).toBe(3);
    expect(JSON.stringify(body)).not.toMatch(/"id"/);
  });
});

describe('simulador', () => {
  it('avanza a lo largo de la ruta y vuelve al inicio', () => {
    const w = new RouteWalker(DEMO_DRIVER_ROUTE, 10);
    expect(w.positionAt(0).position).toEqual(DEMO_DRIVER_ROUTE[0]);
    const lap = (w.totalLength / 10) * 1000;
    const p = w.positionAt(lap).position;
    expect(p.lat).toBeCloseTo(DEMO_DRIVER_ROUTE[0]!.lat, 6);
    expect(p.lng).toBeCloseTo(DEMO_DRIVER_ROUTE[0]!.lng, 6);
  });
});

describe('socket', () => {
  it('rechaza conexiones sin token y entrega la ubicación del viaje demo', async () => {
    await mock.app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = mock.app.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${port}`;

    const anon = connect(url, { transports: ['websocket'], reconnection: false });
    const rejected = await new Promise<string>((resolve) =>
      anon.on('connect_error', (e) => resolve(e.message)),
    );
    expect(rejected).toBe('UNAUTHORIZED');
    anon.close();

    const { accessToken } = await register();
    const client = connect(url, { transports: ['websocket'], auth: { token: accessToken } });
    await new Promise<void>((resolve) => client.on('connect', resolve));

    const received = new Promise<unknown>((resolve) =>
      client.on('trip.driverLocation.v1', resolve),
    );
    mock.emitDemoTripLocation();
    expect(TripDriverLocationV1.parse(await received).tripId).toBe(DEMO_TRIP_ID);

    const ack = await client.emitWithAck('driver.location.v1', {
      lat: 4.3,
      lng: -74.8,
      heading: 10,
      speed: 5,
      accuracy: 8,
      ts: Date.now(),
    });
    expect(ack).toEqual({ ok: true });
    client.close();
  });
});
