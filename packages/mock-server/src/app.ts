import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import type {
  ApiError,
  ClientToServerEvents,
  ErrorCode,
  Me,
  ServerToClientEvents,
  UserRole,
} from '@rideapp/contracts';
import {
  AutocompleteQuery,
  AutocompleteResponse,
  ClientToServerSchemas,
  computeFare,
  DEFAULT_CURRENCY,
  encodePolyline,
  GoogleLoginRequest,
  haversineMeters,
  HealthResponse,
  isInServiceAreaBounds,
  LoginRequest,
  Me as MeSchema,
  NearbyDriversResponse,
  PlaceDetails,
  PlaceDetailsQuery,
  QuoteRequest,
  QuoteResponse,
  RefreshRequest,
  RegisterRequest,
  ReverseGeocodeQuery,
  ReverseGeocodeResponse,
  SocketEvent,
  TokenPair,
  TripDriverLocationV1,
  UpdateMeRequest,
} from '@rideapp/contracts';
import {
  DEMO_DRIVER_ROUTE,
  DEMO_FARE_RULES,
  FIXTURE_PLACES,
  searchFixturePlaces,
} from '@rideapp/contracts/fixtures';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { Server } from 'socket.io';
import type { z } from 'zod';
import { RouteWalker } from './simulator.js';

/** Viaje fijo cuya ubicación de conductor emite el simulador a todos los sockets. */
export const DEMO_TRIP_ID = '00000000-0000-4000-8000-000000000001';

const ACCESS_PREFIX = 'mock-access.';
const REFRESH_PREFIX = 'mock-refresh.';
const ROUTE_DETOUR_FACTOR = 1.3;
const AVG_SPEED_MPS = 25 / 3.6;

export interface MockServerOptions {
  /** Intervalo del simulador en ms; 0 lo desactiva (útil en tests). */
  simulatorIntervalMs?: number;
  logger?: boolean;
}

interface MockUser extends Me {
  password: string | null;
}

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new HttpError(400, 'VALIDATION_FAILED', 'Datos inválidos', result.error.issues);
  }
  return result.data;
}

/** Valida también las respuestas: el mock nunca puede prometer algo que el contrato no permite. */
function send<T extends z.ZodType>(schema: T, data: z.input<T>): z.infer<T> {
  return schema.parse(data);
}

export function buildMockServer(options: MockServerOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false });
  const usersById = new Map<string, MockUser>();
  const startedAt = Date.now();

  const walkers = [0, 1500, 3200].map((offset) => new RouteWalker(DEMO_DRIVER_ROUTE, 8, offset));

  // ---------- Utilidades de sesión falsa ----------

  const issueTokens = (user: MockUser) =>
    send(TokenPair, {
      accessToken: `${ACCESS_PREFIX}${user.id}`,
      expiresIn: 900,
      refreshToken: `${REFRESH_PREFIX}${user.id}.${randomUUID()}`,
    });

  const createUser = (
    email: string | null,
    fullName: string,
    role: UserRole,
    password: string | null,
  ) => {
    const user: MockUser = {
      id: randomUUID(),
      email,
      emailVerified: password === null,
      fullName,
      phone: null,
      role,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      password,
    };
    usersById.set(user.id, user);
    return user;
  };

  const findByEmail = (email: string) => [...usersById.values()].find((u) => u.email === email);

  const userFromAccessToken = (token: string | undefined): MockUser | undefined => {
    if (!token?.startsWith(ACCESS_PREFIX)) return undefined;
    return usersById.get(token.slice(ACCESS_PREFIX.length));
  };

  const requireUser = (req: FastifyRequest): MockUser => {
    const header = req.headers.authorization;
    const user = userFromAccessToken(header?.startsWith('Bearer ') ? header.slice(7) : undefined);
    if (!user) throw new HttpError(401, 'UNAUTHORIZED', 'Sesión inválida');
    return user;
  };

  const toMe = ({ password: _password, ...me }: MockUser) => send(MeSchema, me);

  // ---------- Errores ----------

  app.setErrorHandler((err, req, reply: FastifyReply) => {
    const body: ApiError =
      err instanceof HttpError
        ? { code: err.code, message: err.message, details: err.details, requestId: req.id }
        : { code: 'INTERNAL', message: 'Error interno', requestId: req.id };
    if (!(err instanceof HttpError)) req.log.error(err);
    void reply.status(err instanceof HttpError ? err.statusCode : 500).send(body);
  });

  app.setNotFoundHandler((req, reply) => {
    void reply
      .status(404)
      .send({ code: 'NOT_FOUND', message: 'Ruta no encontrada', requestId: req.id });
  });

  void app.register(cors, { origin: true });

  // ---------- Rutas (mismo prefijo que el API real) ----------

  void app.register(
    (api, _opts, done) => {
      api.get('/health/live', () => send(HealthResponse, { status: 'ok' }));
      api.get('/health/ready', () =>
        send(HealthResponse, { status: 'ok', checks: { mock: 'up' } }),
      );

      api.post('/auth/register', (req, reply) => {
        const body = parse(RegisterRequest, req.body);
        if (findByEmail(body.email)) throw new HttpError(409, 'CONFLICT', 'No se pudo registrar');
        const user = createUser(body.email, body.fullName, body.role, body.password);
        void reply.status(201);
        return issueTokens(user);
      });

      api.post('/auth/login', (req) => {
        const body = parse(LoginRequest, req.body);
        const user = findByEmail(body.email);
        if (!user || user.password !== body.password) {
          throw new HttpError(401, 'INVALID_CREDENTIALS', 'Credenciales inválidas');
        }
        return issueTokens(user);
      });

      // En el mock cualquier idToken sirve: se usa como "sub" de Google.
      api.post('/auth/google', (req) => {
        const body = parse(GoogleLoginRequest, req.body);
        const email = `google-${body.idToken.slice(0, 16)}@example.com`.toLowerCase();
        const user =
          findByEmail(email) ?? createUser(email, 'Usuario Google', body.role ?? 'PASSENGER', null);
        return issueTokens(user);
      });

      api.post('/auth/refresh', (req) => {
        const body = parse(RefreshRequest, req.body);
        const userId = body.refreshToken.startsWith(REFRESH_PREFIX)
          ? body.refreshToken.slice(REFRESH_PREFIX.length).split('.')[0]
          : undefined;
        const user = userId ? usersById.get(userId) : undefined;
        if (!user) throw new HttpError(401, 'UNAUTHORIZED', 'Sesión inválida');
        return issueTokens(user);
      });

      api.post('/auth/logout', (req, reply) => {
        requireUser(req);
        void reply.status(204).send();
      });

      api.get('/me', (req) => toMe(requireUser(req)));

      api.patch('/me', (req) => {
        const user = requireUser(req);
        const body = parse(UpdateMeRequest, req.body);
        if (body.fullName !== undefined) user.fullName = body.fullName;
        if (body.phone !== undefined) user.phone = body.phone;
        return toMe(user);
      });

      api.get('/geo/autocomplete', (req) => {
        requireUser(req);
        const { q } = parse(AutocompleteQuery, req.query);
        return send(AutocompleteResponse, {
          suggestions: searchFixturePlaces(q).map((p) => ({
            placeId: p.placeId,
            primaryText: p.name,
            secondaryText: p.formattedAddress,
          })),
        });
      });

      api.get<{ Params: { placeId: string } }>('/geo/place/:placeId', (req) => {
        requireUser(req);
        parse(PlaceDetailsQuery, req.query);
        const place = FIXTURE_PLACES.find((p) => p.placeId === req.params.placeId);
        if (!place) throw new HttpError(404, 'NOT_FOUND', 'Lugar no encontrado');
        return send(PlaceDetails, {
          placeId: place.placeId,
          formattedAddress: place.formattedAddress,
          location: place.location,
        });
      });

      api.get('/geo/reverse', (req) => {
        requireUser(req);
        const point = parse(ReverseGeocodeQuery, req.query);
        const nearest = [...FIXTURE_PLACES].sort(
          (a, b) => haversineMeters(point, a.location) - haversineMeters(point, b.location),
        )[0];
        const close = nearest && haversineMeters(point, nearest.location) < 1500;
        return send(ReverseGeocodeResponse, {
          formattedAddress: close ? `Cerca de ${nearest.formattedAddress}` : null,
        });
      });

      api.get('/drivers/nearby', (req) => {
        requireUser(req);
        parse(ReverseGeocodeQuery, req.query);
        const elapsed = Date.now() - startedAt;
        return send(NearbyDriversResponse, {
          drivers: walkers.map((w) => {
            const { position, heading } = w.positionAt(elapsed);
            // Igual que el API real: posiciones redondeadas (~100 m), sin IDs.
            return {
              position: { lat: +position.lat.toFixed(3), lng: +position.lng.toFixed(3) },
              heading,
            };
          }),
        });
      });

      api.post('/trips/quote', (req) => {
        requireUser(req);
        const body = parse(QuoteRequest, req.body);
        if (!isInServiceAreaBounds(body.origin) || !isInServiceAreaBounds(body.destination)) {
          throw new HttpError(422, 'OUT_OF_SERVICE_AREA', 'Fuera de la zona de servicio');
        }
        const distanceMeters = Math.round(
          haversineMeters(body.origin, body.destination) * ROUTE_DETOUR_FACTOR,
        );
        const durationSeconds = Math.round(distanceMeters / AVG_SPEED_MPS);
        return send(QuoteResponse, {
          quoteId: randomUUID(),
          amount: {
            amountCents: computeFare(
              DEMO_FARE_RULES[body.category],
              distanceMeters,
              durationSeconds,
            ),
            currency: DEFAULT_CURRENCY,
          },
          distanceMeters,
          durationSeconds,
          polyline: encodePolyline([body.origin, body.destination]),
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        });
      });

      done();
    },
    { prefix: '/api' },
  );

  // ---------- Socket.IO ----------

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(app.server, {
    cors: { origin: true },
  });

  io.use((socket, next) => {
    const token: unknown = socket.handshake.auth['token'];
    const user = userFromAccessToken(typeof token === 'string' ? token : undefined);
    if (!user) return next(new Error('UNAUTHORIZED'));
    socket.data = { userId: user.id };
    next();
  });

  io.on('connection', (socket) => {
    const { userId } = socket.data as { userId: string };
    void socket.join(`user:${userId}`);

    socket.on(SocketEvent.DriverLocation, (payload, ack) => {
      const ok = ClientToServerSchemas[SocketEvent.DriverLocation].safeParse(payload).success;
      ack?.(ok ? { ok: true } : { ok: false, code: 'VALIDATION_FAILED' });
    });
  });

  const emitDemoTripLocation = () => {
    const { position, heading } = walkers[0]!.positionAt(Date.now() - startedAt);
    io.emit(
      SocketEvent.TripDriverLocation,
      TripDriverLocationV1.parse({
        tripId: DEMO_TRIP_ID,
        position,
        heading,
        etaSeconds: null,
        ts: Date.now(),
      }),
    );
  };

  let timer: NodeJS.Timeout | undefined;
  const interval = options.simulatorIntervalMs ?? 2000;
  app.addHook('onReady', (done) => {
    if (interval > 0) timer = setInterval(emitDemoTripLocation, interval);
    done();
  });
  app.addHook('onClose', (_instance, done) => {
    clearInterval(timer);
    void io.close();
    done();
  });

  return { app, io, emitDemoTripLocation };
}
