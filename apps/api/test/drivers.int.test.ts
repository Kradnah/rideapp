import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type AdminDriverDetail,
  type AdminDriverList,
  type AdminLiveDrivers,
  CURRENT_POLICY_VERSION,
  type DriverAccount,
  type DriverAvailabilityV1,
  type DriverLocationV1,
  GIRARDOT_CENTER,
  type NearbyDriversResponse,
  type SignedFileUrl,
  TokenPair,
} from '@rideapp/contracts';
import sharp from 'sharp';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FieldCrypto } from '../src/common/crypto/field-crypto.js';
import { ENV } from '../src/config/config.module.js';
import type { Env } from '../src/config/env.js';
import { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { RedisService } from '../src/infra/redis/redis.service.js';
import { createAdmin } from '../src/modules/admin/admin-provisioning.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { TokenService } from '../src/modules/auth/token.service.js';
import { PresenceSweeper } from '../src/modules/realtime/presence-sweeper.js';
import { RealtimeGateway } from '../src/modules/realtime/realtime.gateway.js';
import { type IntegrationApp, multipartFile, startIntegrationApp } from './helpers/int-app.js';

/**
 * Fase 2: cuenta de conductor, documentos, revisión del admin, disponibilidad y ubicación en vivo.
 * Postgres/PostGIS y Redis reales (Testcontainers); los sockets se prueban contra el puerto real.
 */

let t: IntegrationApp;
let prisma: PrismaService;
let adminToken: string;
let adminId: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  t = await startIntegrationApp();
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
  // El login del panel ya se prueba en auth.int.test.ts: aquí basta un token con el segundo factor.
  adminToken = await t.app.get(TokenService).signAccessToken({
    sub: admin.userId,
    role: 'ADMIN',
    sid: randomUUID(),
    amr: ['pwd', 'totp'],
  });
}, 240_000);

afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await t?.stop();
});

// ---------- utilidades ----------

const consent = { acceptTerms: true, policyVersion: CURRENT_POLICY_VERSION };

async function register(role: 'DRIVER' | 'PASSENGER') {
  const res = await t.call('POST', '/auth/register', {
    body: {
      email: `${role.toLowerCase()}-${randomUUID()}@example.com`,
      password: 'caballo-azul-girardot',
      fullName: role === 'DRIVER' ? 'Carlos Conductor' : 'Pía Pasajera',
      role,
      consent,
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  const tokens = TokenPair.parse(res.json());
  const id = JSON.parse(Buffer.from(tokens.accessToken.split('.')[1]!, 'base64url').toString())
    .sub as string;
  return { id, token: tokens.accessToken, tokens };
}

const jpegWithExif = () =>
  sharp({ create: { width: 64, height: 48, channels: 3, background: '#336699' } })
    .withExif({ IFD0: { ImageDescription: 'secreto-gps-4.3035' } })
    .jpeg()
    .toBuffer();
const png = () =>
  sharp({ create: { width: 32, height: 32, channels: 4, background: '#00000000' } })
    .png()
    .toBuffer();
const pdf = () =>
  Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  );

async function upload(token: string, type: string, data: Buffer, contentType = 'image/jpeg') {
  const { payload, headers } = multipartFile(data, { contentType });
  return t.call('PUT', `/drivers/documents/${type}`, { token, payload, headers });
}

const plate = () => {
  const L = () => String.fromCharCode(65 + Math.floor(Math.random() * 26));
  return `${L()}${L()}${L()}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
};

/** Conductor con todo completo y enviado a revisión. */
async function submittedDriver() {
  const driver = await register('DRIVER');
  const { token } = driver;
  expect(
    (
      await t.call('POST', '/drivers/onboarding', {
        token,
        body: { licenseNumber: '1070123456', phone: '+573001234567' },
      })
    ).statusCode,
  ).toBe(200);
  const vehicle = await t.call('POST', '/drivers/vehicles', {
    token,
    body: {
      plate: plate(),
      brand: 'Chevrolet',
      model: 'Spark',
      color: 'Blanco',
      year: 2018,
      category: 'STANDARD',
    },
  });
  expect(vehicle.statusCode, vehicle.body).toBe(201);
  expect((await upload(token, 'DRIVER_LICENSE', await jpegWithExif())).statusCode).toBe(200);
  expect((await upload(token, 'VEHICLE_REGISTRATION', await png(), 'image/png')).statusCode).toBe(
    200,
  );
  expect((await upload(token, 'SOAT', pdf(), 'application/pdf')).statusCode).toBe(200);
  const submit = await t.call('POST', '/drivers/me/submit', { token });
  expect(submit.statusCode, submit.body).toBe(200);
  return driver;
}

async function approvedDriver() {
  const driver = await submittedDriver();
  const res = await t.call('POST', `/admin/drivers/${driver.id}/approve`, { token: adminToken });
  expect(res.statusCode, res.body).toBe(204);
  return driver;
}

function openSocket(token: string | null): Socket {
  const socket = connect(t.url, {
    transports: ['websocket'],
    reconnection: false,
    auth: token ? { token } : {},
  });
  sockets.push(socket);
  return socket;
}

async function connected(token: string): Promise<Socket> {
  const socket = openSocket(token);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sendLocation(
  socket: Socket,
  overrides: Partial<DriverLocationV1> = {},
): Promise<{ ok: boolean; code?: string }> {
  const payload: DriverLocationV1 = {
    lat: GIRARDOT_CENTER.lat,
    lng: GIRARDOT_CENTER.lng,
    heading: 92,
    speed: 5,
    accuracy: 8,
    ts: Date.now(),
    ...overrides,
  };
  return socket.timeout(3000).emitWithAck('driver.location.v1', payload);
}

async function nearby(token: string, at = GIRARDOT_CENTER) {
  const res = await t.call('GET', `/drivers/nearby?lat=${at.lat}&lng=${at.lng}`, { token });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as NearbyDriversResponse).drivers;
}

// ---------- cuenta de conductor ----------

describe('registro del conductor', () => {
  it('perfil → vehículo → documentos → enviar a revisión', async () => {
    const { id, token } = await register('DRIVER');

    const empty = (await t.call('GET', '/drivers/me', { token })).json() as DriverAccount;
    expect(empty).toMatchObject({
      status: null,
      submitted: false,
      availability: 'OFFLINE',
      missing: {
        profile: true,
        vehicle: true,
        documents: ['DRIVER_LICENSE', 'VEHICLE_REGISTRATION', 'SOAT'],
      },
    });

    const profile = await t.call('POST', '/drivers/onboarding', {
      token,
      body: { licenseNumber: '1070abc999', phone: '+573001112233' },
    });
    expect(profile.json()).toMatchObject({ status: 'PENDING', licenseLast4: 'C999' });
    // La licencia se guarda cifrada; el teléfono queda en el perfil del usuario.
    const row = await prisma.driverProfile.findUniqueOrThrow({ where: { userId: id } });
    expect(row.licenseNumberEnc).not.toContain('1070');
    expect(t.app.get(FieldCrypto).decrypt(row.licenseNumberEnc)).toBe('1070ABC999');
    expect((await t.call('GET', '/me', { token })).json()).toMatchObject({
      phone: '+573001112233',
    });

    const vehicle = await t.call('POST', '/drivers/vehicles', {
      token,
      body: {
        plate: 'abc-12d',
        brand: 'Yamaha',
        model: 'NMAX',
        color: 'Negra',
        year: 2022,
        category: 'MOTO',
      },
    });
    expect(vehicle.statusCode, vehicle.body).toBe(201);
    expect(vehicle.json()).toMatchObject({ plate: 'ABC12D', active: true });

    const incomplete = await t.call('POST', '/drivers/me/submit', { token });
    expect(incomplete.statusCode).toBe(422);
    expect(incomplete.json()).toMatchObject({ code: 'REQUIREMENTS_INCOMPLETE' });

    expect((await upload(token, 'DRIVER_LICENSE', await jpegWithExif())).json()).toMatchObject({
      type: 'DRIVER_LICENSE',
      mime: 'image/jpeg',
      status: 'PENDING',
    });
    await upload(token, 'VEHICLE_REGISTRATION', await png(), 'image/png');
    await upload(token, 'SOAT', pdf(), 'application/pdf');

    const submitted = (
      await t.call('POST', '/drivers/me/submit', { token })
    ).json() as DriverAccount;
    expect(submitted).toMatchObject({ status: 'PENDING', submitted: true });
    expect(submitted.missing).toEqual({ profile: false, vehicle: false, documents: [] });
    expect(
      await prisma.auditLog.count({ where: { action: 'driver.submitted', entityId: id } }),
    ).toBe(1);

    // Cualquier cambio posterior obliga a reenviar.
    await upload(token, 'SOAT', pdf(), 'application/pdf');
    expect(
      ((await t.call('GET', '/drivers/me', { token })).json() as DriverAccount).submitted,
    ).toBe(false);
    expect(await prisma.driverDocument.count({ where: { driverId: id } })).toBe(3);
  });

  it('solo los conductores: un pasajero recibe 403', async () => {
    const { token } = await register('PASSENGER');
    const res = await t.call('POST', '/drivers/onboarding', {
      token,
      body: { licenseNumber: '1070123456', phone: '+573001234567' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('valida placa, perfil previo y campos extra', async () => {
    const { token } = await register('DRIVER');
    const car = {
      plate: 'ABC123',
      brand: 'Kia',
      model: 'Picanto',
      color: 'Gris',
      year: 2020,
      category: 'STANDARD',
    };
    expect((await t.call('POST', '/drivers/vehicles', { token, body: car })).statusCode).toBe(404);
    await t.call('POST', '/drivers/onboarding', {
      token,
      body: { licenseNumber: '1070123456', phone: '+573001234567' },
    });
    expect(
      (await t.call('POST', '/drivers/vehicles', { token, body: { ...car, plate: 'ABC12D' } }))
        .statusCode,
    ).toBe(400);
    expect(
      (await t.call('POST', '/drivers/vehicles', { token, body: { ...car, active: false } }))
        .statusCode,
    ).toBe(400);
    expect((await t.call('POST', '/drivers/vehicles', { token, body: car })).statusCode).toBe(201);
    const dup = await t.call('POST', '/drivers/vehicles', {
      token,
      body: { ...car, plate: 'abc 123' },
    });
    expect(dup.statusCode).toBe(409);
  });

  it('un conductor no puede tocar vehículos ajenos (IDOR)', async () => {
    const a = await submittedDriver();
    const b = await register('DRIVER');
    await t.call('POST', '/drivers/onboarding', {
      token: b.token,
      body: { licenseNumber: '1070123456', phone: '+573001234567' },
    });
    const vehicles = (await t.call('GET', '/drivers/vehicles', { token: a.token })).json() as {
      id: string;
    }[];
    const target = vehicles[0]!.id;
    expect(
      (await t.call('DELETE', `/drivers/vehicles/${target}`, { token: b.token })).statusCode,
    ).toBe(404);
    expect(
      (await t.call('POST', `/drivers/vehicles/${target}/activate`, { token: b.token })).statusCode,
    ).toBe(404);
    expect(
      (await t.call('DELETE', '/drivers/vehicles/no-es-uuid', { token: b.token })).statusCode,
    ).toBe(400);
  });
});

describe('documentos', () => {
  async function driverWithProfile() {
    const d = await register('DRIVER');
    await t.call('POST', '/drivers/onboarding', {
      token: d.token,
      body: { licenseNumber: '1070123456', phone: '+573001234567' },
    });
    return d;
  }

  it('detecta el tipo por magic bytes, no por el Content-Type ni la extensión', async () => {
    const { token } = await driverWithProfile();
    const fake = await upload(
      token,
      'SOAT',
      Buffer.from('<html><script>alert(1)</script>'),
      'image/jpeg',
    );
    expect(fake.statusCode).toBe(415);
    expect(fake.json()).toMatchObject({ code: 'UNSUPPORTED_FILE' });
    const gif = Buffer.from('R0lGODlhAQABAAAAACw=', 'base64');
    expect((await upload(token, 'SOAT', gif, 'image/gif')).statusCode).toBe(415);
    // Cabecera JPEG válida pero imagen corrupta: sharp la rechaza.
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]);
    expect((await upload(token, 'SOAT', broken)).statusCode).toBe(415);
  });

  it('rechaza archivos de más de 5 MB y tipos de documento desconocidos', async () => {
    const { token } = await driverWithProfile();
    const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(5 * 1024 * 1024 + 10, 32)]);
    const res = await upload(token, 'SOAT', big, 'application/pdf');
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ code: 'FILE_TOO_LARGE' });
    expect((await upload(token, 'PASSPORT', pdf(), 'application/pdf')).statusCode).toBe(400);
    const json = await t.call('PUT', '/drivers/documents/SOAT', { token, body: { file: 'x' } });
    expect(json.statusCode).toBe(415);
  });

  it('se guardan cifrados en disco', async () => {
    const { id, token } = await driverWithProfile();
    await upload(token, 'SOAT', pdf(), 'application/pdf');
    const doc = await prisma.driverDocument.findFirstOrThrow({ where: { driverId: id } });
    expect(doc.storageKey).toMatch(/^driver-documents\/[0-9a-f-]{36}$/);
    const env = t.app.get<symbol, Env>(ENV);
    const raw = await readFile(join(env.STORAGE_DIR, `${doc.storageKey}.bin`));
    expect(raw.includes(Buffer.from('%PDF'))).toBe(false);
    expect(raw.subarray(0, 4).toString()).toBe('RAS1');
  });
});

// ---------- panel admin ----------

describe('revisión en el panel', () => {
  it('cola de pendientes, detalle enmascarado y revelado auditado', async () => {
    const driver = await submittedDriver();
    const list = (
      await t.call('GET', '/admin/drivers?status=PENDING&limit=100', { token: adminToken })
    ).json() as AdminDriverList;
    expect(list.items.some((i) => i.userId === driver.id)).toBe(true);

    const detail = (
      await t.call('GET', `/admin/drivers/${driver.id}`, { token: adminToken })
    ).json() as AdminDriverDetail;
    expect(detail).toMatchObject({
      phoneMasked: '+57 *** *** 4567',
      licenseMasked: '****3456',
      submitted: true,
    });
    expect(JSON.stringify(detail)).not.toContain('1070123456');

    const reveal = await t.call('POST', `/admin/drivers/${driver.id}/reveal`, {
      token: adminToken,
      body: { field: 'licenseNumber' },
    });
    expect(reveal.json()).toEqual({ value: '1070123456' });
    expect(
      await prisma.auditLog.count({
        where: { action: 'admin.driver_field_revealed', entityId: driver.id, actorId: adminId },
      }),
    ).toBe(1);
  });

  it('documentos con URL firmada: tipo validado, sin EXIF y sin manipulación posible', async () => {
    const driver = await submittedDriver();
    const detail = (
      await t.call('GET', `/admin/drivers/${driver.id}`, { token: adminToken })
    ).json() as AdminDriverDetail;
    const license = detail.documents.find((d) => d.type === 'DRIVER_LICENSE')!;
    const soat = detail.documents.find((d) => d.type === 'SOAT')!;

    const signed = (
      await t.call('GET', `/admin/drivers/${driver.id}/documents/${license.id}/url`, {
        token: adminToken,
      })
    ).json() as SignedFileUrl;
    const file = await t.call('GET', signed.path);
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('image/jpeg');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(file.headers['content-disposition']).toMatch(/^inline/);
    expect(file.rawPayload.includes(Buffer.from('secreto-gps'))).toBe(false);
    expect((await sharp(file.rawPayload).metadata()).exif).toBeUndefined();

    // Firma de otro documento, firma alterada o caducada → 404.
    const [, query] = signed.path.split('?');
    expect((await t.call('GET', `/files/driver-documents/${soat.id}?${query}`)).statusCode).toBe(
      404,
    );
    expect((await t.call('GET', signed.path.replace(/sig=./, 'sig=A'))).statusCode).toBe(404);
    const params = new URLSearchParams(query);
    params.set('exp', String(Date.now() - 1000));
    expect(
      (await t.call('GET', `/files/driver-documents/${license.id}?${params}`)).statusCode,
    ).toBe(404);

    const pdfUrl = (
      await t.call('GET', `/admin/drivers/${driver.id}/documents/${soat.id}/url`, {
        token: adminToken,
      })
    ).json() as SignedFileUrl;
    const pdfFile = await t.call('GET', pdfUrl.path);
    expect(pdfFile.headers['content-disposition']).toMatch(/^attachment/);

    // El documento de un conductor no se pide por la ruta de otro.
    const other = await submittedDriver();
    expect(
      (
        await t.call('GET', `/admin/drivers/${other.id}/documents/${license.id}/url`, {
          token: adminToken,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      await prisma.auditLog.count({
        where: { action: 'admin.driver_document_viewed', actorId: adminId },
      }),
    ).toBeGreaterThanOrEqual(2);
  });

  it('aprobar: estado, documentos aceptados, auditoría y sin doble decisión', async () => {
    const driver = await submittedDriver();
    expect(
      (await t.call('POST', `/admin/drivers/${driver.id}/approve`, { token: adminToken }))
        .statusCode,
    ).toBe(204);
    const account = (
      await t.call('GET', '/drivers/me', { token: driver.token })
    ).json() as DriverAccount;
    expect(account.status).toBe('APPROVED');
    expect(account.documents.every((d) => d.status === 'ACCEPTED')).toBe(true);
    const again = await t.call('POST', `/admin/drivers/${driver.id}/reject`, {
      token: adminToken,
      body: { reason: 'Demasiado tarde' },
    });
    expect(again.statusCode).toBe(409);
    // Aprobado: ya no puede cambiar sus datos por su cuenta.
    expect((await upload(driver.token, 'SOAT', pdf(), 'application/pdf')).statusCode).toBe(409);
    expect(
      await prisma.auditLog.count({
        where: { action: 'admin.driver_approved', entityId: driver.id },
      }),
    ).toBe(1);
  });

  it('rechazar con motivo: el conductor lo ve, corrige y reenvía', async () => {
    const driver = await submittedDriver();
    const res = await t.call('POST', `/admin/drivers/${driver.id}/reject`, {
      token: adminToken,
      body: { reason: 'La foto del SOAT no se lee' },
    });
    expect(res.statusCode).toBe(204);
    const account = (
      await t.call('GET', '/drivers/me', { token: driver.token })
    ).json() as DriverAccount;
    expect(account).toMatchObject({
      status: 'REJECTED',
      submitted: false,
      statusReason: 'La foto del SOAT no se lee',
    });
    // No se aprueba algo que no está enviado.
    expect(
      (await t.call('POST', `/admin/drivers/${driver.id}/approve`, { token: adminToken }))
        .statusCode,
    ).toBe(409);

    await upload(driver.token, 'SOAT', pdf(), 'application/pdf');
    const resubmitted = (
      await t.call('POST', '/drivers/me/submit', { token: driver.token })
    ).json() as DriverAccount;
    expect(resubmitted).toMatchObject({ status: 'PENDING', submitted: true });
  });

  it('el panel exige ADMIN con segundo factor', async () => {
    const driver = await register('DRIVER');
    expect((await t.call('GET', '/admin/drivers', { token: driver.token })).statusCode).toBe(403);
    const noTotp = await t.app.get(TokenService).signAccessToken({
      sub: adminId,
      role: 'ADMIN',
      sid: randomUUID(),
      amr: ['pwd'],
    });
    expect((await t.call('GET', '/admin/drivers', { token: noTotp })).statusCode).toBe(403);
    expect(
      (await t.call('GET', `/admin/drivers/${randomUUID()}`, { token: adminToken })).statusCode,
    ).toBe(404);
  });
});

// ---------- disponibilidad y ubicación ----------

describe('en línea y ubicación en vivo', () => {
  it('solo un conductor aprobado se pone en línea', async () => {
    const driver = await submittedDriver();
    const res = await t.call('POST', '/drivers/me/online', { token: driver.token });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'DRIVER_NOT_APPROVED' });
  });

  it('el handshake exige un token válido', async () => {
    for (const token of [null, 'no-es-un-jwt']) {
      const socket = openSocket(token);
      const err = await new Promise<Error>((resolve) => socket.once('connect_error', resolve));
      expect(err.message).toBe('UNAUTHORIZED');
    }
  });

  it('en línea → ubicación → el pasajero lo ve cerca, aproximado y sin ID', async () => {
    const driver = await approvedDriver();
    const passenger = await register('PASSENGER');
    const online = await t.call('POST', '/drivers/me/online', { token: driver.token });
    expect(online.json()).toMatchObject({ availability: 'AVAILABLE', locationIntervalSeconds: 12 });

    // En línea pero sin ubicación todavía: no aparece.
    const exact = { lat: 4.30412, lng: -74.80377 };
    const socket = await connected(driver.token);
    expect(await sendLocation(socket, exact)).toEqual({ ok: true });

    const drivers = await nearby(passenger.token);
    const seen = drivers.find(
      (d) =>
        Math.abs(d.position.lat - exact.lat) < 0.002 &&
        Math.abs(d.position.lng - exact.lng) < 0.002,
    );
    expect(seen).toBeDefined();
    expect(seen!.position).toEqual({ lat: 4.304, lng: -74.804 });
    expect(seen!.heading).toBe(90);
    expect(JSON.stringify(drivers)).not.toContain(driver.id);

    // Fuera de la zona de servicio no se consulta nada; un conductor no puede usar el endpoint.
    expect(await nearby(passenger.token, { lat: 4.711, lng: -74.0721 })).toEqual([]);
    expect(
      (await t.call('GET', '/drivers/nearby?lat=4.3&lng=-74.8', { token: driver.token }))
        .statusCode,
    ).toBe(403);

    // El admin ve la posición exacta con el nombre.
    const live = (
      await t.call('GET', '/admin/drivers/live', { token: adminToken })
    ).json() as AdminLiveDrivers;
    expect(live.drivers.find((d) => d.driverId === driver.id)).toMatchObject({
      fullName: 'Carlos Conductor',
      position: exact,
      availability: 'AVAILABLE',
    });
    const overview = (await t.call('GET', '/admin/overview', { token: adminToken })).json() as {
      drivers: { online: number };
    };
    expect(overview.drivers.online).toBeGreaterThanOrEqual(1);

    // Fuera de línea: desaparece y el servidor ya no acepta su ubicación.
    expect(
      (await t.call('POST', '/drivers/me/offline', { token: driver.token })).json(),
    ).toMatchObject({
      availability: 'OFFLINE',
    });
    expect(await nearby(passenger.token)).not.toContainEqual(seen);
    await sleep(1000);
    expect(await sendLocation(socket, exact)).toEqual({ ok: false, code: 'OFFLINE' });
  });

  it('descarta lecturas imposibles, imprecisas, falsas o demasiado seguidas', async () => {
    const driver = await approvedDriver();
    await t.call('POST', '/drivers/me/online', { token: driver.token });
    const socket = await connected(driver.token);

    expect(await sendLocation(socket, { accuracy: 500 })).toEqual({
      ok: false,
      code: 'LOW_ACCURACY',
    });
    await sleep(1000);
    expect(await sendLocation(socket, { ts: Date.now() - 10 * 60_000 })).toEqual({
      ok: false,
      code: 'STALE',
    });
    await sleep(1000);
    expect(await sendLocation(socket, { mocked: true })).toEqual({
      ok: false,
      code: 'IMPLAUSIBLE',
    });
    await sleep(1000);
    expect(await sendLocation(socket)).toEqual({ ok: true });
    // Inmediatamente después: límite de 1 mensaje por segundo.
    expect(await sendLocation(socket)).toEqual({ ok: false, code: 'RATE_LIMITED' });
    await sleep(1000);
    // 5 km en un segundo: GPS falso.
    expect(await sendLocation(socket, { lat: GIRARDOT_CENTER.lat + 0.045 })).toEqual({
      ok: false,
      code: 'IMPLAUSIBLE',
    });
    await sleep(1000);
    expect(await sendLocation(socket, { foo: 1 } as never)).toEqual({
      ok: false,
      code: 'VALIDATION_FAILED',
    });

    const passenger = await register('PASSENGER');
    const pSocket = await connected(passenger.token);
    expect(await sendLocation(pSocket)).toEqual({ ok: false, code: 'FORBIDDEN' });
  }, 20_000);

  it('suspender lo saca de línea y se lo avisa por el socket', async () => {
    const driver = await approvedDriver();
    await t.call('POST', '/drivers/me/online', { token: driver.token });
    const socket = await connected(driver.token);
    expect(await sendLocation(socket)).toEqual({ ok: true });

    const notice = new Promise<DriverAvailabilityV1>((resolve) =>
      socket.once('driver.availability.v1', resolve),
    );
    const res = await t.call('POST', `/admin/drivers/${driver.id}/suspend`, {
      token: adminToken,
      body: { reason: 'Quejas reiteradas de pasajeros' },
    });
    expect(res.statusCode).toBe(204);
    expect(await notice).toEqual({ availability: 'OFFLINE', reason: 'SUSPENDED' });

    const account = (
      await t.call('GET', '/drivers/me', { token: driver.token })
    ).json() as DriverAccount;
    expect(account).toMatchObject({ status: 'SUSPENDED', availability: 'OFFLINE' });
    expect((await t.call('POST', '/drivers/me/online', { token: driver.token })).statusCode).toBe(
      403,
    );

    expect(
      (await t.call('POST', `/admin/drivers/${driver.id}/reactivate`, { token: adminToken }))
        .statusCode,
    ).toBe(204);
    expect((await t.call('POST', '/drivers/me/online', { token: driver.token })).statusCode).toBe(
      200,
    );
  });

  it('el latido saca de línea a quien deja de enviar su ubicación', async () => {
    const driver = await approvedDriver();
    await t.call('POST', '/drivers/me/online', { token: driver.token });
    const socket = await connected(driver.token);
    expect(await sendLocation(socket)).toEqual({ ok: true });

    const notice = new Promise<DriverAvailabilityV1>((resolve) =>
      socket.once('driver.availability.v1', resolve),
    );
    await t.app.get(RedisService).client.del('lock:presence-sweeper');
    const removed = await t.app.get(PresenceSweeper).run(Date.now() + 61_000);
    expect(removed).toContain(driver.id);
    expect(await notice).toEqual({ availability: 'OFFLINE', reason: 'INACTIVE' });
    expect(
      ((await t.call('GET', '/drivers/me', { token: driver.token })).json() as DriverAccount)
        .availability,
    ).toBe('OFFLINE');
  });

  it('cerrar la sesión desconecta el socket y saca al conductor de línea', async () => {
    const driver = await approvedDriver();
    await t.call('POST', '/drivers/me/online', { token: driver.token });
    const socket = await connected(driver.token);
    expect(await sendLocation(socket)).toEqual({ ok: true });

    const revoked = new Promise((resolve) => socket.once('session.revoked.v1', resolve));
    const disconnected = new Promise((resolve) => socket.once('disconnect', resolve));
    expect((await t.call('POST', '/auth/logout-all', { token: driver.token })).statusCode).toBe(
      204,
    );
    await (t.app.get(RealtimeGateway) as unknown as { revalidate(): Promise<void> }).revalidate();
    await revoked;
    await disconnected;
    const state = await t.app.get(RedisService).client.exists(`driver:${driver.id}:state`);
    expect(state).toBe(0);
  });
});
