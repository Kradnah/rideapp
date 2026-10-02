import type { RealtimeSocket } from '@rideapp/api-client';
import type { DriverLocationRejection, DriverLocationV1 } from '@rideapp/contracts';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

/**
 * Envío de la ubicación del conductor en línea (10.2). Vive fuera de React porque la tarea de
 * segundo plano de expo-task-manager se ejecuta sin componentes montados.
 *
 * - Con permiso "todo el tiempo": `startLocationUpdatesAsync` con servicio en primer plano y
 *   notificación persistente ("Estás en línea"), obligatoria en Android.
 * - Sin él: solo mientras la app está abierta (`watchPositionAsync`).
 * - Sin `distanceInterval`: si el conductor está parado también hay que enviar, o el servidor lo
 *   sacaría de línea a los 60 s por inactividad.
 * - Al pasar a "fuera de línea" se detiene todo: nunca se rastrea a un conductor desconectado.
 */
export const LOCATION_TASK = 'rideapp-driver-location';

export type ReporterMode = 'background' | 'foreground';
export type ReporterEvent =
  | { type: 'sent'; at: number }
  | { type: 'rejected'; code: DriverLocationRejection | 'TIMEOUT' }
  | { type: 'offline' };

let socket: RealtimeSocket | null = null;
let watcher: Location.LocationSubscription | null = null;
let pending: DriverLocationV1 | null = null;
const listeners = new Set<(e: ReporterEvent) => void>();

function toPayload(loc: Location.LocationObject): DriverLocationV1 {
  const { latitude, longitude, heading, speed, accuracy } = loc.coords;
  return {
    lat: latitude,
    lng: longitude,
    heading: heading !== null && heading >= 0 && heading <= 360 ? heading : null,
    speed: speed !== null && speed >= 0 ? speed : null,
    accuracy: accuracy ?? 9999,
    ts: Math.round(loc.timestamp),
    // Android marca las ubicaciones de apps de GPS falso (14.4).
    ...(loc.mocked !== undefined && { mocked: loc.mocked }),
  };
}

function emit(event: ReporterEvent) {
  for (const l of listeners) l(event);
}

async function send(payload: DriverLocationV1): Promise<void> {
  if (!socket?.connected) {
    // Solo el último punto: para la disponibilidad no sirve una posición vieja (10.2, paso 4).
    pending = payload;
    return;
  }
  try {
    const ack = await socket.timeout(5_000).emitWithAck('driver.location.v1', payload);
    if (ack.ok) emit({ type: 'sent', at: Date.now() });
    else if (ack.code === 'OFFLINE') emit({ type: 'offline' });
    else emit({ type: 'rejected', code: ack.code as DriverLocationRejection });
  } catch {
    emit({ type: 'rejected', code: 'TIMEOUT' });
  }
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
  LOCATION_TASK,
  async ({ data, error }) => {
    const last = data?.locations.at(-1);
    if (error || !last) return;
    // Proceso relanzado sin la app (no hay socket ni sesión): se para en vez de rastrear a ciegas.
    if (!socket) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => undefined);
      return;
    }
    await send(toPayload(last));
  },
);

export const locationReporter = {
  subscribe(listener: (e: ReporterEvent) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** El socket se (re)conectó: envía el último punto pendiente, si no está caducado. */
  flush(): void {
    const last = pending;
    pending = null;
    if (last && Date.now() - last.ts < 60_000) void send(last);
  },

  async start(realtime: RealtimeSocket, intervalSeconds: number): Promise<ReporterMode> {
    await this.stop();
    socket = realtime;
    const background = await Location.getBackgroundPermissionsAsync();
    if (background.granted) {
      await Location.startLocationUpdatesAsync(LOCATION_TASK, {
        accuracy: Location.Accuracy.High,
        timeInterval: intervalSeconds * 1000,
        distanceInterval: 0,
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: 'Estás en línea',
          notificationBody: 'rideapp Conductor usa tu ubicación para ofrecerte viajes cercanos.',
          notificationColor: '#0f766e',
          killServiceOnDestroy: true,
        },
      });
      return 'background';
    }
    watcher = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: intervalSeconds * 1000,
        distanceInterval: 0,
      },
      (loc) => void send(toPayload(loc)),
    );
    return 'foreground';
  },

  async stop(): Promise<void> {
    watcher?.remove();
    watcher = null;
    pending = null;
    socket = null;
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => undefined);
    }
  },
};
