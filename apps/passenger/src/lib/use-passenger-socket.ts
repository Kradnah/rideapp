import { createRealtime } from '@rideapp/api-client';
import type { TripStatusV1 } from '@rideapp/contracts';
import { useSession } from '@rideapp/mobile-core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { config } from './config';

/**
 * Socket del pasajero mientras sigue un viaje (8.10): solo escucha `trip.status.v1`. El servidor
 * lo mete en la sala del viaje; la app no elige salas. Si el token caducó, se renueva y reintenta.
 */
export function usePassengerSocket(
  active: boolean,
  onStatus: (event: TripStatusV1) => void,
): { connected: boolean } {
  const { getAccessToken, signOut } = useSession();
  const [connected, setConnected] = useState(false);
  const onStatusRef = useRef(onStatus);
  useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);

  const socket = useMemo(
    () =>
      active
        ? createRealtime({
            url: config.socketUrl,
            getAccessToken: () => getAccessToken(),
            autoConnect: false,
          })
        : null,
    [active, getAccessToken],
  );

  useEffect(() => {
    if (!socket) return;
    let retry: ReturnType<typeof setTimeout> | undefined;
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', (err) => {
      if (err.message !== 'UNAUTHORIZED') return;
      void getAccessToken(true).then((token) => {
        if (token) retry = setTimeout(() => socket.connect(), 2_000);
      });
    });
    socket.on('trip.status.v1', (e) => onStatusRef.current(e));
    socket.on('session.revoked.v1', () => void signOut());
    socket.connect();
    return () => {
      clearTimeout(retry);
      socket.removeAllListeners();
      socket.disconnect();
      setConnected(false);
    };
  }, [socket, getAccessToken, signOut]);

  return { connected };
}
