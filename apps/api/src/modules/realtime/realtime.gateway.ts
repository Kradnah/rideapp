import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import {
  type ClientToServerEvents,
  ClientToServerSchemas,
  type DriverLocationRejection,
  type DriverLocationV1,
  type ServerToClientEvents,
  SocketEvent,
  type UserRole,
} from '@rideapp/contracts';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server, type Socket } from 'socket.io';
import { InjectEnv } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { RedisService } from '../../infra/redis/redis.service.js';
import { SessionRevocationService } from '../auth/session-revocation.service.js';
import { TokenService } from '../auth/token.service.js';
import { LocationService } from '../location/location.service.js';

interface SocketData {
  userId: string;
  role: UserRole;
  sid: string;
  lastLocationAt: number;
}

type AppServer = Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, object, SocketData>;
type Emit = ServerToClientEvents;

/** 1 mensaje por segundo como máximo por socket (8.5, paso 2), con un poco de margen. */
const MIN_LOCATION_GAP_MS = 900;
/** Cada cuánto se comprueba que las sesiones de los sockets abiertos sigan vigentes (8.10, paso 5). */
const REVALIDATE_EVERY_MS = 60_000;

export const userRoom = (userId: string) => `user:${userId}`;
export const tripRoom = (tripId: string) => `trip:${tripId}`;

/** Salas a las que debe unirse un socket al conectar (p. ej. la de su viaje activo), 8.10, paso 2. */
export type RoomResolver = (user: { id: string; role: UserRole }) => Promise<string[]>;

/** Recibe cada posición aceptada de un conductor que está en un viaje (8.5, paso 2). */
export type TripLocationListener = (
  driverId: string,
  tripId: string,
  location: DriverLocationV1,
) => Promise<void>;

/**
 * Gateway Socket.IO (8.10), montado sobre el mismo servidor HTTP del API:
 * - el access token llega en `auth` del handshake, nunca en la URL;
 * - el servidor decide las salas (`user:{id}`); el cliente nunca elige;
 * - cada mensaje entrante se valida con Zod y tiene límite por socket;
 * - adaptador de Redis para funcionar con varias réplicas.
 */
@Injectable()
export class RealtimeGateway implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeGateway.name);
  private io: AppServer | null = null;
  private revalidateTimer: NodeJS.Timeout | null = null;
  private readonly resolvers: RoomResolver[] = [];
  private readonly tripLocationListeners: TripLocationListener[] = [];

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly tokens: TokenService,
    private readonly revocations: SessionRevocationService,
    private readonly location: LocationService,
    private readonly redis: RedisService,
    @InjectEnv() private readonly env: Env,
  ) {}

  onApplicationBootstrap(): void {
    const io: AppServer = new Server(this.adapterHost.httpAdapter.getHttpServer(), {
      path: '/socket.io',
      serveClient: false,
      // Solo WebSocket: sin long-polling no hacen falta sesiones pegajosas entre réplicas.
      transports: ['websocket'],
      maxHttpBufferSize: 10_000,
      cors: { origin: this.env.CORS_ORIGINS, credentials: true },
    });
    io.adapter(
      createAdapter(this.redis.createSubscriber('io-pub'), this.redis.createSubscriber('io-sub')),
    );

    io.use((socket, next) => {
      void this.authenticate(socket).then(
        (ok) => next(ok ? undefined : new Error('UNAUTHORIZED')),
        (err: unknown) => {
          this.logger.error({ err }, 'Fallo al autenticar un socket');
          next(new Error('UNAUTHORIZED'));
        },
      );
    });
    io.on('connection', (socket) => this.onConnection(socket));
    this.io = io;

    this.revalidateTimer = setInterval(() => void this.revalidate(), REVALIDATE_EVERY_MS);
    this.revalidateTimer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.revalidateTimer) clearInterval(this.revalidateTimer);
    // No se llama a io.close(): cerraría el servidor HTTP, que lo cierra Nest.
    this.io?.local.disconnectSockets(true);
    this.io = null;
  }

  /** Envía un evento a todos los sockets de un usuario (en cualquier réplica). */
  emitToUser<E extends keyof Emit>(userId: string, event: E, ...args: Parameters<Emit[E]>): void {
    this.io?.to(userRoom(userId)).emit(event, ...args);
  }

  /** Un mismo socket en varias de las salas recibe el evento una sola vez. */
  emitToRooms<E extends keyof Emit>(rooms: string[], event: E, ...args: Parameters<Emit[E]>): void {
    this.io?.to(rooms).emit(event, ...args);
  }

  /** Une a una sala todos los sockets de un usuario, en cualquier réplica (adaptador de Redis). */
  joinUser(userId: string, room: string): void {
    this.io?.in(userRoom(userId)).socketsJoin(room);
  }

  /** Vacía una sala (p. ej. al terminar el viaje). */
  closeRoom(room: string): void {
    this.io?.in(room).socketsLeave(room);
  }

  /** Lo usan otros módulos (trips) para decidir salas al conectar, sin depender de ellos aquí. */
  registerRoomResolver(resolver: RoomResolver): void {
    this.resolvers.push(resolver);
  }

  /** Lo usa trips para reenviar la posición del conductor a la sala de su viaje. */
  registerTripLocationListener(listener: TripLocationListener): void {
    this.tripLocationListeners.push(listener);
  }

  private async authenticate(socket: AppSocket): Promise<boolean> {
    const token: unknown = socket.handshake.auth['token'];
    if (typeof token !== 'string' || token.length > 4096) return false;
    const claims = await this.tokens.verifyAccessToken(token);
    if (!claims || (await this.revocations.isRevoked(claims.sid))) return false;
    socket.data = { userId: claims.sub, role: claims.role, sid: claims.sid, lastLocationAt: 0 };
    return true;
  }

  private onConnection(socket: AppSocket): void {
    const { userId, role } = socket.data;
    void socket.join(userRoom(userId));
    void this.joinResolvedRooms(socket);

    socket.on(SocketEvent.DriverLocation, (payload, ack) => {
      const reply = (res: { ok: true } | { ok: false; code: DriverLocationRejection }) => {
        if (typeof ack === 'function') ack(res);
      };
      if (role !== 'DRIVER') return reply({ ok: false, code: 'FORBIDDEN' });

      const now = Date.now();
      if (now - socket.data.lastLocationAt < MIN_LOCATION_GAP_MS) {
        return reply({ ok: false, code: 'RATE_LIMITED' });
      }
      socket.data.lastLocationAt = now;

      const parsed = ClientToServerSchemas[SocketEvent.DriverLocation].safeParse(payload);
      if (!parsed.success) return reply({ ok: false, code: 'VALIDATION_FAILED' });

      this.location.updateLocation(userId, parsed.data, now).then(
        (result) => {
          if (!result.ok) return reply(result);
          reply({ ok: true });
          if (result.tripId) this.notifyTripLocation(userId, result.tripId, parsed.data);
        },
        (err: unknown) => {
          this.logger.error({ err }, 'No se pudo guardar la ubicación');
          reply({ ok: false, code: 'OFFLINE' });
        },
      );
    });

    if (role === 'DRIVER') {
      socket.on('disconnect', () => void this.onDriverDisconnect(userId));
    }
  }

  private notifyTripLocation(driverId: string, tripId: string, loc: DriverLocationV1): void {
    for (const listener of this.tripLocationListeners) {
      listener(driverId, tripId, loc).catch((err: unknown) =>
        this.logger.warn({ err, tripId }, 'No se pudo procesar la ubicación del viaje'),
      );
    }
  }

  private async joinResolvedRooms(socket: AppSocket): Promise<void> {
    const { userId, role } = socket.data;
    for (const resolve of this.resolvers) {
      try {
        const rooms = await resolve({ id: userId, role });
        if (rooms.length) await socket.join(rooms);
      } catch (err) {
        this.logger.warn({ err }, 'No se pudieron resolver las salas del socket');
      }
    }
  }

  /** Sin socket no se le puede ofrecer un viaje: sale de la capa GEO (8.5, paso 4). */
  private async onDriverDisconnect(userId: string): Promise<void> {
    try {
      const remaining = await this.io?.in(userRoom(userId)).fetchSockets();
      if (!remaining?.length) await this.location.removeFromGeo(userId);
    } catch (err) {
      this.logger.warn({ err }, 'No se pudo retirar al conductor de la capa GEO');
    }
  }

  /**
   * Desconecta los sockets cuya sesión se cerró (logout, "cerrar todas", reutilización de un
   * refresh token). A los conductores además se les saca de línea.
   */
  private async revalidate(): Promise<void> {
    if (!this.io) return;
    for (const socket of this.io.of('/').sockets.values()) {
      try {
        if (!(await this.revocations.isRevoked(socket.data.sid))) continue;
        socket.emit(SocketEvent.SessionRevoked, { reason: 'LOGOUT_ALL' });
        socket.disconnect(true);
        if (socket.data.role === 'DRIVER') await this.location.goOffline(socket.data.userId);
      } catch (err) {
        this.logger.warn({ err }, 'No se pudo revalidar un socket');
      }
    }
  }
}
