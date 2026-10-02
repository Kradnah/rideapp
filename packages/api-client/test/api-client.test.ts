import type { AddressInfo } from 'node:net';
import { CURRENT_POLICY_VERSION } from '@rideapp/contracts';
import { buildMockServer, DEMO_TRIP_ID } from '@rideapp/mock-server/app';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiClientError, createApiClient, createRealtime, HttpClient } from '../src/index.js';

/**
 * Tests de contrato: el cliente habla con el mock-server real por HTTP.
 * Cuando exista el backend completo, los mismos tests podrán apuntar a él.
 */
const mock = buildMockServer({ simulatorIntervalMs: 0 });
let origin: string;

beforeAll(async () => {
  await mock.app.listen({ port: 0, host: '127.0.0.1' });
  origin = `http://127.0.0.1:${(mock.app.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await mock.app.close();
});

function client(session: { token: string | null; refresh?: string }) {
  const api = createApiClient({
    baseUrl: `${origin}/api`,
    getAccessToken: () => session.token,
    refreshSession: async () => {
      if (!session.refresh) return null;
      const pair = await api.auth.refresh(session.refresh);
      session.token = pair.accessToken;
      session.refresh = pair.refreshToken;
      return pair.accessToken;
    },
  });
  return api;
}

describe('contra el mock-server', () => {
  it('registro, perfil y cotización', async () => {
    const session: { token: string | null; refresh?: string } = { token: null };
    const api = client(session);

    const pair = await api.auth.register({
      email: 'cliente@example.com',
      password: 'una-clave-larga',
      fullName: 'Cliente Demo',
      role: 'PASSENGER',
      consent: { acceptTerms: true, policyVersion: CURRENT_POLICY_VERSION },
    });
    session.token = pair.accessToken;

    expect((await api.me.get()).fullName).toBe('Cliente Demo');

    const quote = await api.trips.quote({
      origin: { lat: 4.3036, lng: -74.803 },
      destination: { lat: 4.2955, lng: -74.788 },
      category: 'MOTO',
    });
    expect(quote.amount.currency).toBe('COP');
  });

  it('convierte los errores en ApiClientError con el código del contrato', async () => {
    const api = client({ token: null });
    const err = await api.auth
      .login({ email: 'nadie@example.com', password: 'x' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err).toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });
  });

  it('refresca el token al recibir 401 y reintenta', async () => {
    const api = client({ token: null });
    const pair = await api.auth.register({
      email: 'refresh@example.com',
      password: 'una-clave-larga',
      fullName: 'Refresh',
      role: 'DRIVER',
      consent: { acceptTerms: true, policyVersion: CURRENT_POLICY_VERSION },
    });
    const session = { token: 'token-caducado', refresh: pair.refreshToken };
    const api2 = client(session);
    expect((await api2.me.get()).email).toBe('refresh@example.com');
    expect(session.token).not.toBe('token-caducado');
  });

  it('socket tipado: recibe la ubicación del viaje demo', async () => {
    const api = client({ token: null });
    const { accessToken } = await api.auth.register({
      email: 'socket@example.com',
      password: 'una-clave-larga',
      fullName: 'Socket',
      role: 'PASSENGER',
      consent: { acceptTerms: true, policyVersion: CURRENT_POLICY_VERSION },
    });
    const socket = createRealtime({ url: origin, getAccessToken: () => accessToken });
    await new Promise<void>((resolve) => socket.on('connect', resolve));
    const received = new Promise<string>((resolve) =>
      socket.on('trip.driverLocation.v1', (p) => resolve(p.tripId)),
    );
    mock.emitDemoTripLocation();
    expect(await received).toBe(DEMO_TRIP_ID);
    socket.close();
  });
});

describe('HttpClient', () => {
  it('varias peticiones con 401 simultáneas disparan un solo refresh', async () => {
    let valid = 'nuevo';
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>)['authorization'];
      return auth === `Bearer ${valid}`
        ? new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
        : new Response(JSON.stringify({ code: 'UNAUTHORIZED', message: 'x' }), { status: 401 });
    });
    const refreshSession = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return valid;
    });
    const http = new HttpClient({
      baseUrl: 'http://x/api',
      fetch: fetchMock as unknown as typeof fetch,
      getAccessToken: () => 'viejo',
      refreshSession,
    });

    const { HealthResponse } = await import('@rideapp/contracts');
    await Promise.all([1, 2, 3].map(() => http.request('GET', '/me', { schema: HealthResponse })));
    expect(refreshSession).toHaveBeenCalledTimes(1);
    valid = 'otro';
  });

  it('si el refresh falla, propaga el 401', async () => {
    const http = new HttpClient({
      baseUrl: 'http://x/api',
      fetch: (async () =>
        new Response(JSON.stringify({ code: 'UNAUTHORIZED', message: 'x' }), {
          status: 401,
        })) as typeof fetch,
      getAccessToken: () => 'viejo',
      refreshSession: async () => null,
    });
    await expect(http.request('GET', '/me')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rechaza respuestas fuera de contrato', async () => {
    const { Me } = await import('@rideapp/contracts');
    const http = new HttpClient({
      baseUrl: 'http://x/api',
      fetch: (async () =>
        new Response(JSON.stringify({ id: 'no-uuid' }), { status: 200 })) as typeof fetch,
    });
    await expect(http.request('GET', '/me', { schema: Me })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('error de red → NETWORK_ERROR', async () => {
    const http = new HttpClient({
      baseUrl: 'http://x/api',
      fetch: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
    });
    await expect(http.request('GET', '/health/live', { auth: false })).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });
});
