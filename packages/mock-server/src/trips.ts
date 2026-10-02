import { randomUUID } from 'node:crypto';
import {
  ACTIVE_TRIP_STATUSES,
  ActiveTripResponse,
  CancelTripRequest,
  computeFare,
  CreateTripRequest,
  decodePolyline,
  DEFAULT_CURRENCY,
  DriverOfferResponse,
  encodePolyline,
  haversineMeters,
  IdempotencyKey,
  isInServiceAreaBounds,
  type LatLng,
  QuoteRequest,
  QuoteResponse,
  type ServerToClientEvents,
  type TripDriverLocation,
  TripDriverLocationResponse,
  type TripStatus,
  Trip,
  VehicleCategory,
} from '@rideapp/contracts';
import { DEMO_FARE_RULES } from '@rideapp/contracts/fixtures';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { HttpError, parse, send } from './http.js';
import type { MockUser } from './users.js';

const ROUTE_DETOUR_FACTOR = 1.3;
const AVG_SPEED_MPS = 25 / 3.6;
const QUOTE_TTL_MS = 5 * 60_000;
/** Viaje simulado: el conductor demo se mueve un paso cada tanto. */
const SIM_STEP_MS = 1500;
const SIM_APPROACH_STEPS = 12;
const SIM_RIDE_STEPS = 20;
const SIM_WAIT_MS = 6000;

interface MockQuote {
  passengerId: string;
  category: VehicleCategory;
  amountCents: number;
  origin: LatLng;
  destination: LatLng;
  originAddress: string | null;
  destinationAddress: string | null;
  distanceMeters: number;
  durationSeconds: number;
  polyline: string;
  expiresAt: number;
  used: boolean;
}

type Emit = <E extends keyof ServerToClientEvents>(
  userId: string,
  event: E,
  ...args: Parameters<ServerToClientEvents[E]>
) => void;

/**
 * Viajes en memoria (8.7–8.8) con las mismas reglas visibles que el API real. Como el mock no
 * tiene conductores reales, un "conductor demo" acepta solo unos segundos después de pedir y
 * hace el viaje solo: se acerca (con ETA), llega, inicia, recorre la ruta y finaliza (Fase 4).
 */
export class MockTrips {
  private readonly quotes = new Map<string, MockQuote>();
  private readonly trips = new Map<string, Trip & { passengerId: string }>();
  private readonly idempotent = new Map<string, string>();
  private readonly locations = new Map<string, TripDriverLocation>();
  private readonly timers = new Set<NodeJS.Timeout>();

  constructor(
    private readonly assignDelayMs: number,
    private readonly emit: Emit,
  ) {}

  register(api: FastifyInstance, requireUser: (req: FastifyRequest) => MockUser): void {
    const requirePassenger = (req: FastifyRequest) => {
      const user = requireUser(req);
      if (user.role !== 'PASSENGER') throw new HttpError(403, 'FORBIDDEN', 'Solo pasajeros');
      return user;
    };
    const ownTrip = (req: FastifyRequest<{ Params: { id: string } }>) => {
      const user = requireUser(req);
      const trip = this.trips.get(req.params.id);
      if (!trip || trip.passengerId !== user.id) {
        throw new HttpError(404, 'NOT_FOUND', 'Viaje no encontrado');
      }
      return trip;
    };

    api.post('/trips/quote', (req) => {
      const user = requirePassenger(req);
      const body = parse(QuoteRequest, req.body);
      if (!isInServiceAreaBounds(body.origin) || !isInServiceAreaBounds(body.destination)) {
        throw new HttpError(
          422,
          'OUT_OF_SERVICE_AREA',
          'Por ahora solo operamos en Girardot, Ricaurte y Flandes.',
        );
      }
      if (haversineMeters(body.origin, body.destination) < 100) {
        throw new HttpError(422, 'VALIDATION_FAILED', 'El destino está demasiado cerca.');
      }
      const distanceMeters = Math.round(
        haversineMeters(body.origin, body.destination) * ROUTE_DETOUR_FACTOR,
      );
      const durationSeconds = Math.round(distanceMeters / AVG_SPEED_MPS);
      const polyline = encodePolyline([body.origin, body.destination]);
      const expiresAt = Date.now() + QUOTE_TTL_MS;
      const options = VehicleCategory.options.map((category) => {
        const quoteId = randomUUID();
        const amountCents = computeFare(DEMO_FARE_RULES[category], distanceMeters, durationSeconds);
        this.quotes.set(quoteId, {
          passengerId: user.id,
          category,
          amountCents,
          origin: body.origin,
          destination: body.destination,
          originAddress: body.originAddress || null,
          destinationAddress: body.destinationAddress || null,
          distanceMeters,
          durationSeconds,
          polyline,
          expiresAt,
          used: false,
        });
        return { quoteId, category, amount: { amountCents, currency: DEFAULT_CURRENCY } };
      });
      return send(QuoteResponse, {
        distanceMeters,
        durationSeconds,
        polyline,
        expiresAt: new Date(expiresAt).toISOString(),
        options,
      });
    });

    api.post('/trips', (req, reply) => {
      const user = requirePassenger(req);
      const body = parse(CreateTripRequest, req.body);
      const header = req.headers['idempotency-key'];
      const key = header === undefined ? undefined : parse(IdempotencyKey, header);
      const replay = key && this.idempotent.get(`${user.id}:${key}`);
      if (replay) return reply.code(201).send(this.view(this.trips.get(replay)!));

      const quote = this.quotes.get(body.quoteId);
      if (!quote || quote.passengerId !== user.id) {
        throw new HttpError(404, 'NOT_FOUND', 'Cotización no encontrada');
      }
      if (quote.expiresAt <= Date.now()) {
        throw new HttpError(409, 'QUOTE_EXPIRED', 'La cotización caducó. Vuelve a cotizar.');
      }
      if (this.activeFor(user.id)) {
        throw new HttpError(409, 'ACTIVE_TRIP_EXISTS', 'Ya tienes un viaje en curso.');
      }
      if (quote.used) throw new HttpError(409, 'CONFLICT', 'Esta cotización ya se usó.');
      quote.used = true;

      const trip: Trip & { passengerId: string } = {
        id: randomUUID(),
        passengerId: user.id,
        status: 'SEARCHING',
        category: quote.category,
        paymentMethod: body.paymentMethod,
        origin: quote.origin,
        destination: quote.destination,
        originAddress: quote.originAddress,
        destinationAddress: quote.destinationAddress,
        amount: { amountCents: quote.amountCents, currency: DEFAULT_CURRENCY },
        distanceMeters: quote.distanceMeters,
        durationSeconds: quote.durationSeconds,
        polyline: quote.polyline,
        pin: String(Math.floor(Math.random() * 10_000)).padStart(4, '0'),
        requestedAt: new Date().toISOString(),
        acceptedAt: null,
        arrivedAt: null,
        startedAt: null,
        completedAt: null,
        cancelledAt: null,
        cancelledBy: null,
        cancelReason: null,
        driver: null,
        passenger: null,
      };
      this.trips.set(trip.id, trip);
      if (key) this.idempotent.set(`${user.id}:${key}`, trip.id);
      this.status(trip, 'REQUESTED');

      const timer = setTimeout(() => {
        this.timers.delete(timer);
        if (trip.status !== 'SEARCHING') return;
        trip.status = 'DRIVER_ASSIGNED';
        trip.acceptedAt = new Date().toISOString();
        trip.driver = {
          fullName: 'Conductor Demo',
          vehicle: {
            plate: trip.category === 'MOTO' ? 'XYZ12A' : 'GIR123',
            brand: trip.category === 'MOTO' ? 'Yamaha' : 'Chevrolet',
            model: trip.category === 'MOTO' ? 'NMAX' : 'Spark GT',
            color: 'Rojo',
            category: trip.category,
          },
        };
        this.status(trip, 'SEARCHING');
        this.simulateRide(trip);
      }, this.assignDelayMs);
      this.timers.add(timer);

      return reply.code(201).send(this.view(trip));
    });

    api.get('/trips/active', (req) => {
      const user = requireUser(req);
      const trip = this.activeFor(user.id);
      return send(ActiveTripResponse, { trip: trip ? this.view(trip) : null });
    });

    api.get<{ Params: { id: string } }>('/trips/:id', (req) => this.view(ownTrip(req)));

    api.get<{ Params: { id: string } }>('/trips/:id/driver-location', (req) => {
      const trip = ownTrip(req);
      const busy = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVED', 'IN_PROGRESS'].includes(trip.status);
      return send(TripDriverLocationResponse, {
        location: busy ? (this.locations.get(trip.id) ?? null) : null,
      });
    });

    api.post<{ Params: { id: string } }>('/trips/:id/cancel', (req) => {
      const trip = ownTrip(req);
      const body = parse(CancelTripRequest, req.body ?? {});
      if (!['REQUESTED', 'SEARCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVED'].includes(trip.status)) {
        throw new HttpError(409, 'CONFLICT', 'Este viaje ya no se puede cancelar.');
      }
      const from = trip.status;
      trip.status = 'CANCELLED';
      trip.cancelledAt = new Date().toISOString();
      trip.cancelledBy = 'PASSENGER';
      trip.cancelReason = body.reason ?? null;
      this.status(trip, from);
      return this.view(trip);
    });

    // El mock no ofrece viajes a conductores: para eso está el API real.
    api.get('/drivers/me/offer', (req) => {
      requireUser(req);
      return send(DriverOfferResponse, { offer: null });
    });
  }

  close(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  /** El conductor demo hace el viaje solo, paso a paso, con los mismos eventos que el API. */
  private simulateRide(trip: Trip & { passengerId: string }): void {
    // Sale ~1 km al norte de la recogida.
    const start = { lat: trip.origin.lat + 0.009, lng: trip.origin.lng + 0.002 };
    const ride = decodePolyline(trip.polyline);
    const steps: (() => void)[] = [];
    for (let i = 0; i <= SIM_APPROACH_STEPS; i++) {
      const f = i / SIM_APPROACH_STEPS;
      const remaining = (SIM_APPROACH_STEPS - i) * (SIM_STEP_MS / 1000) * 8;
      steps.push(() => this.locate(trip, lerp(start, trip.origin, f), remaining));
    }
    steps.push(() => this.advance(trip, 'DRIVER_ARRIVED', 'arrivedAt'));
    for (let i = 0; i < SIM_WAIT_MS / SIM_STEP_MS; i++) {
      steps.push(() => this.locate(trip, trip.origin, null));
    }
    steps.push(() => this.advance(trip, 'IN_PROGRESS', 'startedAt'));
    for (let i = 0; i <= SIM_RIDE_STEPS; i++) {
      const f = i / SIM_RIDE_STEPS;
      const remaining = Math.round(trip.durationSeconds * (1 - f));
      steps.push(() => this.locate(trip, alongPath(ride, f), remaining));
    }
    steps.push(() => this.advance(trip, 'COMPLETED', 'completedAt'));

    const run = (i: number) => {
      const step = steps[i];
      if (!step || !['DRIVER_ASSIGNED', 'DRIVER_ARRIVED', 'IN_PROGRESS'].includes(trip.status)) {
        this.locations.delete(trip.id);
        return;
      }
      step();
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        run(i + 1);
      }, SIM_STEP_MS);
      this.timers.add(timer);
    };
    run(0);
  }

  private locate(trip: Trip & { passengerId: string }, position: LatLng, eta: number | null) {
    const payload: TripDriverLocation = {
      tripId: trip.id,
      position,
      heading: 180,
      etaSeconds: eta === null ? null : Math.round(eta),
      ts: Date.now(),
    };
    this.locations.set(trip.id, payload);
    this.emit(trip.passengerId, 'trip.driverLocation.v1', payload);
  }

  private advance(
    trip: Trip & { passengerId: string },
    to: TripStatus,
    at: 'arrivedAt' | 'startedAt' | 'completedAt',
  ): void {
    const from = trip.status;
    trip.status = to;
    trip[at] = new Date().toISOString();
    this.status(trip, from);
  }

  private activeFor(passengerId: string) {
    return [...this.trips.values()].find(
      (t) =>
        t.passengerId === passengerId &&
        (ACTIVE_TRIP_STATUSES as readonly TripStatus[]).includes(t.status),
    );
  }

  private view({ passengerId: _p, ...trip }: Trip & { passengerId: string }): Trip {
    return send(Trip, trip);
  }

  private status(trip: Trip & { passengerId: string }, previousStatus: TripStatus): void {
    this.emit(trip.passengerId, 'trip.status.v1', {
      tripId: trip.id,
      status: trip.status,
      previousStatus,
      cancelledBy: trip.cancelledBy,
      at: new Date().toISOString(),
    });
  }
}

function lerp(a: LatLng, b: LatLng, f: number): LatLng {
  return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f };
}

/** Punto a la fracción `f` (0–1) del recorrido, por tramos. */
function alongPath(path: LatLng[], f: number): LatLng {
  if (path.length < 2) return path[0]!;
  const lengths = path.slice(1).map((p, i) => haversineMeters(path[i]!, p));
  let target = lengths.reduce((a, b) => a + b, 0) * f;
  for (let i = 0; i < lengths.length; i++) {
    if (target <= lengths[i]! || i === lengths.length - 1) {
      return lerp(path[i]!, path[i + 1]!, lengths[i]! ? Math.min(1, target / lengths[i]!) : 1);
    }
    target -= lengths[i]!;
  }
  return path.at(-1)!;
}
