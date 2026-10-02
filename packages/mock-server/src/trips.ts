import { randomUUID } from 'node:crypto';
import {
  ACTIVE_TRIP_STATUSES,
  ActiveTripResponse,
  CancelTripRequest,
  computeFare,
  CreateTripRequest,
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
 * tiene conductores reales, un "conductor demo" acepta solo unos segundos después de pedir.
 */
export class MockTrips {
  private readonly quotes = new Map<string, MockQuote>();
  private readonly trips = new Map<string, Trip & { passengerId: string }>();
  private readonly idempotent = new Map<string, string>();
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
