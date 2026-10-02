import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import type {
  ApiError,
  ClientToServerEvents,
  ServerToClientEvents,
  UserRole,
} from '@rideapp/contracts';
import {
  AutocompleteQuery,
  AutocompleteResponse,
  CURRENT_POLICY_VERSION,
  GoogleLoginRequest,
  haversineMeters,
  HealthResponse,
  LoginRequest,
  Me as MeSchema,
  NearbyDriversQuery,
  NearbyDriversResponse,
  PlaceDetails,
  PlaceDetailsQuery,
  RefreshRequest,
  ForgotPasswordRequest,
  RegisterRequest,
  ResetPasswordRequest,
  ReverseGeocodeQuery,
  ReverseGeocodeResponse,
  SocketEvent,
  TokenPair,
  TripDriverLocationV1,
  UpdateMeRequest,
  VerifyEmailRequest,
} from '@rideapp/contracts';
import {
  DEMO_DRIVER_ROUTE,
  FIXTURE_PLACES,
  searchFixturePlaces,
} from '@rideapp/contracts/fixtures';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { Server } from 'socket.io';
import { MockDrivers } from './drivers.js';
import { HttpError, parse, send } from './http.js';
import { RouteWalker } from './simulator.js';
import { MockTrips } from './trips.js';
import type { MockUser } from './users.js';

/** En el mock, el código que llega "por correo" es siempre este. */
export const MOCK_EMAIL_CODE = '123456';

/** Viaje fijo cuya ubicación de conductor emite el simulador a todos los sockets. */
export const DEMO_TRIP_ID = '00000000-0000-4000-8000-000000000001';

const ACCESS_PREFIX = 'mock-access.';
const REFRESH_PREFIX = 'mock-refresh.';

export interface MockServerOptions {
  /** Intervalo del simulador en ms; 0 lo desactiva (útil en tests). */
  simulatorIntervalMs?: number;
  /**
   * El mock no tiene panel admin: aprueba al conductor este tiempo después de que envíe sus
   * datos a revisión. 0 = al instante.
   */
  driverApprovalDelayMs?: number;
  /** El "conductor demo" acepta los viajes este tiempo después de pedirlos. */
  tripAssignDelayMs?: number;
  logger?: boolean;
}

export function buildMockServer(options: MockServerOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false });
  const usersById = new Map<string, MockUser>();
  const startedAt = Date.now();

  const walkers = [0, 1500, 3200].map((offset) => new RouteWalker(DEMO_DRIVER_ROUTE, 8, offset));
  const drivers = new MockDrivers(options.driverApprovalDelayMs ?? 5000);
  // `io` se crea después de las rutas: el emisor lo resuelve al usarse.
  let io: Server<ClientToServerEvents, ServerToClientEvents> | null = null;
  const trips = new MockTrips(options.tripAssignDelayMs ?? 4000, (userId, event, ...args) =>
    io?.to(`user:${userId}`).emit(event, ...args),
  );

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
        if (body.consent.policyVersion !== CURRENT_POLICY_VERSION) {
          throw new HttpError(409, 'CONSENT_REQUIRED', 'Acepta la política vigente');
        }
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
        const existing = findByEmail(email);
        if (existing) return issueTokens(existing);
        // Igual que el API real: crear la cuenta exige la autorización de la Ley 1581.
        if (body.consent?.policyVersion !== CURRENT_POLICY_VERSION) {
          throw new HttpError(409, 'CONSENT_REQUIRED', 'Acepta la política para crear tu cuenta');
        }
        return issueTokens(createUser(email, 'Usuario Google', body.role ?? 'PASSENGER', null));
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

      api.post('/auth/logout-all', (req, reply) => {
        requireUser(req);
        void reply.status(204).send();
      });

      api.post('/auth/email/verification', (req, reply) => {
        requireUser(req);
        void reply.status(204).send();
      });

      api.post('/auth/email/verify', (req, reply) => {
        const user = requireUser(req);
        const { code } = parse(VerifyEmailRequest, req.body);
        if (code !== MOCK_EMAIL_CODE) throw new HttpError(400, 'INVALID_CODE', 'Código incorrecto');
        user.emailVerified = true;
        void reply.status(204).send();
      });

      api.post('/auth/password/forgot', (req, reply) => {
        parse(ForgotPasswordRequest, req.body);
        void reply.status(202).send({});
      });

      api.post('/auth/password/reset', (req, reply) => {
        const body = parse(ResetPasswordRequest, req.body);
        const user = findByEmail(body.email);
        if (!user || body.code !== MOCK_EMAIL_CODE) {
          throw new HttpError(400, 'INVALID_CODE', 'Código incorrecto o caducado');
        }
        user.password = body.password;
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
        parse(NearbyDriversQuery, req.query);
        const elapsed = Date.now() - startedAt;
        const simulated = walkers.map((w) => {
          const { position, heading } = w.positionAt(elapsed);
          return { ...position, heading };
        });
        return send(NearbyDriversResponse, {
          drivers: [...simulated, ...drivers.availablePositions()]
            .slice(0, 10)
            // Igual que el API real: posiciones redondeadas (~100 m), sin IDs.
            .map(({ lat, lng, heading }) => ({
              position: { lat: +lat.toFixed(3), lng: +lng.toFixed(3) },
              heading,
            })),
        });
      });

      drivers.register(api, requireUser);

      trips.register(api, requireUser);

      done();
    },
    { prefix: '/api' },
  );

  // ---------- Socket.IO ----------

  const server = new Server<ClientToServerEvents, ServerToClientEvents>(app.server, {
    cors: { origin: true },
  });
  io = server;

  server.use((socket, next) => {
    const token: unknown = socket.handshake.auth['token'];
    const user = userFromAccessToken(typeof token === 'string' ? token : undefined);
    if (!user) return next(new Error('UNAUTHORIZED'));
    socket.data = { userId: user.id };
    next();
  });

  server.on('connection', (socket) => {
    const { userId } = socket.data as { userId: string };
    void socket.join(`user:${userId}`);

    socket.on(SocketEvent.DriverLocation, (payload, ack) =>
      drivers.onLocation(userId, payload, ack),
    );
  });

  const emitDemoTripLocation = () => {
    const { position, heading } = walkers[0]!.positionAt(Date.now() - startedAt);
    server.emit(
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
    drivers.close();
    trips.close();
    void server.close();
    done();
  });

  return { app, io: server, emitDemoTripLocation };
}
