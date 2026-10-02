import { createRealtime, type RealtimeSocket } from '@rideapp/api-client';
import type { DriverAvailabilityV1 } from '@rideapp/contracts';
import { useSession } from '@rideapp/mobile-core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { config } from './config';
import { locationReporter } from './location-reporter';

/**
 * Socket del conductor mientras está en línea (8.10). El token va en el handshake y se pide
 * en cada (re)conexión; si el servidor lo rechaza, se renueva una vez y se reintenta.
 */
export function useDriverSocket(
  active: boolean,
  onAvailability: (event: DriverAvailabilityV1) => void,
): { socket: RealtimeSocket | null; connected: boolean } {
  const { getAccessToken, signOut } = useSession();
  const [connected, setConnected] = useState(false);
  const onAvailabilityRef = useRef(onAvailability);
  useEffect(() => {
    onAvailabilityRef.current = onAvailability;
  }, [onAvailability]);

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
    socket.on('connect', () => {
      setConnected(true);
      locationReporter.flush();
    });
    socket.on('disconnect', () => setConnected(false));
    // Un rechazo del middleware no se reintenta solo: token caducado → uno nuevo y otra vez.
    socket.on('connect_error', (err) => {
      if (err.message !== 'UNAUTHORIZED') return;
      void getAccessToken(true).then((token) => {
        if (token) retry = setTimeout(() => socket.connect(), 2_000);
      });
    });
    socket.on('driver.availability.v1', (e) => onAvailabilityRef.current(e));
    socket.on('session.revoked.v1', () => void signOut());
    socket.connect();
    return () => {
      clearTimeout(retry);
      socket.removeAllListeners();
      socket.disconnect();
      setConnected(false);
    };
  }, [socket, getAccessToken, signOut]);

  return { socket, connected };
}
