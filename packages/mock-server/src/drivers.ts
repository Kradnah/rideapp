import { randomUUID } from 'node:crypto';
import {
  type Ack,
  DriverAccount,
  type DriverAvailability,
  DriverAvailabilityResponse,
  DriverDocument,
  DriverDocumentType,
  DriverLocationV1,
  DriverOnboardingRequest,
  type DriverStatus,
  type LatLng,
  REQUIRED_DRIVER_DOCUMENTS,
  Vehicle,
  VehicleRequest,
} from '@rideapp/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { HttpError, parse, send } from './http.js';
import type { MockUser } from './users.js';

interface MockDriver {
  status: DriverStatus;
  submitted: boolean;
  licenseLast4: string;
  vehicles: Vehicle[];
  documents: DriverDocument[];
  availability: DriverAvailability;
  position: (LatLng & { heading: number | null }) | null;
}

/**
 * Cuenta de conductor en memoria (8.4), con las mismas reglas visibles que el API real.
 * Como el mock no tiene panel admin, aprueba solo al conductor un rato después de enviar.
 */
export class MockDrivers {
  private readonly byId = new Map<string, MockDriver>();
  private readonly timers = new Set<NodeJS.Timeout>();

  constructor(private readonly approvalDelayMs: number) {}

  /** Conductores en línea con posición, para /drivers/nearby. */
  availablePositions(): (LatLng & { heading: number | null })[] {
    return [...this.byId.values()].flatMap((d) =>
      d.availability === 'AVAILABLE' && d.position ? [d.position] : [],
    );
  }

  /** Evento `driver.location.v1` del socket. */
  onLocation(userId: string, payload: unknown, ack?: Ack): void {
    const parsed = DriverLocationV1.safeParse(payload);
    if (!parsed.success) return ack?.({ ok: false, code: 'VALIDATION_FAILED' });
    const driver = this.byId.get(userId);
    if (!driver) return ack?.({ ok: false, code: 'FORBIDDEN' });
    if (driver.availability === 'OFFLINE') return ack?.({ ok: false, code: 'OFFLINE' });
    const { lat, lng, heading } = parsed.data;
    driver.position = { lat, lng, heading };
    ack?.({ ok: true });
  }

  close(): void {
    for (const t of this.timers) clearTimeout(t);
  }

  register(api: FastifyInstance, requireUser: (req: FastifyRequest) => MockUser): void {
    const requireDriver = (req: FastifyRequest) => {
      const user = requireUser(req);
      if (user.role !== 'DRIVER') throw new HttpError(403, 'FORBIDDEN', 'Sin permiso');
      return user;
    };
    const editable = (user: MockUser) => {
      const driver = this.byId.get(user.id);
      if (!driver) throw new HttpError(404, 'NOT_FOUND', 'Completa primero tus datos');
      if (driver.status !== 'PENDING' && driver.status !== 'REJECTED') {
        throw new HttpError(409, 'CONFLICT', 'Tu cuenta ya fue revisada');
      }
      return driver;
    };
    const missingOf = (driver: MockDriver | undefined) => ({
      profile: !driver,
      vehicle: !driver?.vehicles.some((v) => v.active),
      documents: REQUIRED_DRIVER_DOCUMENTS.filter(
        (t) => !driver?.documents.some((d) => d.type === t),
      ),
    });
    const account = (user: MockUser) => {
      const driver = this.byId.get(user.id);
      return send(DriverAccount, {
        status: driver?.status ?? null,
        submitted: driver?.submitted ?? false,
        statusReason: null,
        licenseLast4: driver?.licenseLast4 ?? null,
        vehicles: driver?.vehicles ?? [],
        documents: driver?.documents ?? [],
        missing: missingOf(driver),
        availability: driver?.availability ?? 'OFFLINE',
      });
    };
    const availability = (value: DriverAvailability) =>
      send(DriverAvailabilityResponse, { availability: value, locationIntervalSeconds: 12 });

    // Las subidas llegan en multipart: el mock descarta el contenido y guarda solo los metadatos.
    api.addContentTypeParser('multipart/form-data', (_req, payload, done) => {
      payload.resume();
      payload.on('end', () => done(null, {}));
    });

    api.get('/drivers/me', (req) => account(requireDriver(req)));

    api.post('/drivers/onboarding', (req) => {
      const user = requireDriver(req);
      const body = parse(DriverOnboardingRequest, req.body);
      const existing = this.byId.has(user.id) ? editable(user) : undefined;
      this.byId.set(user.id, {
        status: 'PENDING',
        vehicles: [],
        documents: [],
        availability: 'OFFLINE',
        position: null,
        ...existing,
        submitted: false,
        licenseLast4: body.licenseNumber.slice(-4),
      });
      user.phone = body.phone;
      return account(user);
    });

    api.get('/drivers/vehicles', (req) => this.byId.get(requireDriver(req).id)?.vehicles ?? []);

    api.post('/drivers/vehicles', (req, reply) => {
      const driver = editable(requireDriver(req));
      const body = parse(VehicleRequest, req.body);
      if (driver.vehicles.some((v) => v.plate === body.plate)) {
        throw new HttpError(409, 'CONFLICT', 'Ya registraste un vehículo con esa placa');
      }
      const vehicle = send(Vehicle, {
        ...body,
        id: randomUUID(),
        active: !driver.vehicles.some((v) => v.active),
        createdAt: new Date().toISOString(),
      });
      driver.vehicles.push(vehicle);
      driver.submitted = false;
      void reply.status(201);
      return vehicle;
    });

    api.delete<{ Params: { id: string } }>('/drivers/vehicles/:id', (req, reply) => {
      const driver = editable(requireDriver(req));
      const index = driver.vehicles.findIndex((v) => v.id === req.params.id);
      if (index < 0) throw new HttpError(404, 'NOT_FOUND', 'Vehículo no encontrado');
      const [removed] = driver.vehicles.splice(index, 1);
      if (removed?.active && driver.vehicles[0]) driver.vehicles[0].active = true;
      driver.submitted = false;
      void reply.status(204).send();
    });

    api.post<{ Params: { id: string } }>('/drivers/vehicles/:id/activate', (req) => {
      const driver = this.byId.get(requireDriver(req).id);
      const vehicle = driver?.vehicles.find((v) => v.id === req.params.id);
      if (!driver || !vehicle) throw new HttpError(404, 'NOT_FOUND', 'Vehículo no encontrado');
      for (const v of driver.vehicles) v.active = v === vehicle;
      return vehicle;
    });

    api.put<{ Params: { type: string } }>('/drivers/documents/:type', (req) => {
      const driver = editable(requireDriver(req));
      const type = parse(DriverDocumentType, req.params.type);
      if (!req.headers['content-type']?.startsWith('multipart/form-data')) {
        throw new HttpError(415, 'UNSUPPORTED_FILE', 'Envía el archivo como multipart/form-data');
      }
      const doc = send(DriverDocument, {
        id: randomUUID(),
        type,
        mime: 'image/jpeg',
        sizeBytes: Math.max(1, Number(req.headers['content-length'] ?? 1)),
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      });
      driver.documents = [...driver.documents.filter((d) => d.type !== type), doc];
      driver.submitted = false;
      return doc;
    });

    api.post('/drivers/me/submit', (req) => {
      const user = requireDriver(req);
      const driver = editable(user);
      const missing = missingOf(driver);
      if (missing.vehicle || missing.documents.length > 0) {
        throw new HttpError(422, 'REQUIREMENTS_INCOMPLETE', 'Faltan datos', missing);
      }
      driver.status = 'PENDING';
      driver.submitted = true;
      const approve = () => {
        if (!driver.submitted || driver.status !== 'PENDING') return;
        driver.status = 'APPROVED';
        for (const d of driver.documents) d.status = 'ACCEPTED';
      };
      if (this.approvalDelayMs === 0) approve();
      else {
        const timer = setTimeout(() => {
          this.timers.delete(timer);
          approve();
        }, this.approvalDelayMs);
        this.timers.add(timer);
      }
      return account(user);
    });

    api.post('/drivers/me/online', (req) => {
      const driver = this.byId.get(requireDriver(req).id);
      if (driver?.status !== 'APPROVED') {
        throw new HttpError(403, 'DRIVER_NOT_APPROVED', 'Tu cuenta de conductor no está aprobada');
      }
      driver.availability = 'AVAILABLE';
      return availability('AVAILABLE');
    });

    api.post('/drivers/me/offline', (req) => {
      const driver = this.byId.get(requireDriver(req).id);
      if (driver) {
        driver.availability = 'OFFLINE';
        driver.position = null;
      }
      return availability('OFFLINE');
    });
  }
}
