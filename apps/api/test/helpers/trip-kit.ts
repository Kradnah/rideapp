import { randomUUID } from 'node:crypto';
import {
  CURRENT_POLICY_VERSION,
  type DriverLocationV1,
  GIRARDOT_CENTER,
  type LatLng,
  type QuoteResponse,
  TokenPair,
  Trip,
  type TripStatusV1,
  type VehicleCategory,
} from '@rideapp/contracts';
import { io as connect, type Socket } from 'socket.io-client';
import { expect } from 'vitest';
import { PrismaService } from '../../src/infra/prisma/prisma.service.js';
import type { IntegrationApp } from './int-app.js';

/** Destino de prueba: Unicentro, ~2 km al sureste del centro de Girardot. */
export const UNICENTRO: LatLng = { lat: 4.2955, lng: -74.788 };
export const BOGOTA: LatLng = { lat: 4.711, lng: -74.0721 };

/**
 * Utilidades de los tests de viajes: usuarios, conductores en línea con socket, cotizar y pedir.
 * `t` se pasa como función porque la app se crea en `beforeAll`.
 */
export function tripKit(t: () => IntegrationApp) {
  const sockets: Socket[] = [];

  const consent = { acceptTerms: true, policyVersion: CURRENT_POLICY_VERSION };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function register(role: 'DRIVER' | 'PASSENGER', fullName?: string) {
    const res = await t().call('POST', '/auth/register', {
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
    await t()
      .app.get(PrismaService)
      .driverProfile.create({
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
    const socket = connect(t().url, {
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
    const online = await t().call('POST', '/drivers/me/online', { token: driver.token });
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
    const res = await t().call('POST', '/trips/quote', {
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
    const res = await t().call('POST', '/trips', {
      token,
      body: { quoteId, paymentMethod: 'CASH' },
      headers: { 'idempotency-key': key },
    });
    expect(res.statusCode, res.body).toBe(201);
    return { trip: Trip.parse(res.json()), quoteId };
  }

  const getTrip = async (token: string, id: string) => {
    const res = await t().call('GET', `/trips/${id}`, { token });
    return { status: res.statusCode, trip: res.statusCode === 200 ? Trip.parse(res.json()) : null };
  };

  /** Cierra los sockets abiertos por el test. */
  const disconnectAll = () => {
    for (const s of sockets.splice(0)) s.disconnect();
  };

  return {
    consent,
    sleep,
    register,
    randomPlate,
    approvedDriver,
    connected,
    sendLocation,
    onlineDriverAt,
    next,
    status,
    collect,
    quote,
    requestTrip,
    getTrip,
    disconnectAll,
  };
}
