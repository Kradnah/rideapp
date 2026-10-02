import type { ClientToServerEvents, ServerToClientEvents } from '@rideapp/contracts';
import { io, type Socket } from 'socket.io-client';

export type RealtimeSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface RealtimeOptions {
  /** Origen del API, sin `/api` (p. ej. `https://rideapp-api.julian-lizcano.com`). */
  url: string;
  /** Se llama en cada (re)conexión, así siempre se envía el token vigente (8.10, paso 5). */
  getAccessToken: () => string | null | Promise<string | null>;
  autoConnect?: boolean;
}

/**
 * Socket tipado con los eventos de `contracts`. El token va en `auth` del handshake,
 * nunca en la query string, que acaba en los logs (8.10, paso 1).
 */
export function createRealtime({
  url,
  getAccessToken,
  autoConnect = true,
}: RealtimeOptions): RealtimeSocket {
  return io(url, {
    transports: ['websocket'],
    autoConnect,
    auth: (cb) => {
      void Promise.resolve(getAccessToken()).then((token) => cb({ token }));
    },
  });
}
