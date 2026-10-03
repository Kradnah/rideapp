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
 * - Sin conexión (10.2, paso 4) se guardan los últimos puntos, uno cada 10 s como mucho (lo mismo
 *   que muestrea la traza del viaje), y al reconectar se envían en orden a 1 por segundo (el límite
 *   del socket). El servidor acepta puntos de hasta 2 min: los más viejos se descartan.
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
/** Cola de envío: normalmente 0 o 1 punto; crece solo sin conexión. */
let queue: DriverLocationV1[] = [];
let draining = false;
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

/** El servidor descarta los puntos de más de 120 s; se deja margen para el envío. */
const MAX_AGE_MS = 110_000;
/** Sin conexión, un punto cada 10 s como mucho (11 puntos cubren la ventana de 110 s). */
const OFFLINE_SPACING_MS = 10_000;
const MAX_QUEUE = 12;
/** El servidor admite 1 mensaje de ubicación por segundo y socket. */
const SEND_SPACING_MS = 1_100;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function enqueue(payload: DriverLocationV1): void {
  const last = queue.at(-1);
  const before = queue.at(-2);
  // Sin red: si el último guardado está a menos de 10 s del anterior, se sustituye por el nuevo.
  if (!socket?.connected && last && before && last.ts - before.ts < OFFLINE_SPACING_MS) {
    queue[queue.length - 1] = payload;
  } else {
    queue.push(payload);
  }
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
  void drain();
}

/** Envía la cola en orden (el servidor rechaza un punto anterior al último aceptado). */
async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length > 0 && socket?.connected) {
      const next = queue.shift()!;
      if (Date.now() - next.ts > MAX_AGE_MS) continue;
      await sendNow(next);
      if (queue.length > 0) await sleep(SEND_SPACING_MS);
    }
  } finally {
    draining = false;
  }
}

async function sendNow(payload: DriverLocationV1): Promise<void> {
  if (!socket) return;
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
    enqueue(toPayload(last));
  },
);

export const locationReporter = {
  subscribe(listener: (e: ReporterEvent) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** El socket se (re)conectó: envía lo guardado sin conexión que aún no haya caducado. */
  flush(): void {
    void drain();
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
      (loc) => enqueue(toPayload(loc)),
    );
    return 'foreground';
  },

  async stop(): Promise<void> {
    watcher?.remove();
    watcher = null;
    queue = [];
    socket = null;
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => undefined);
    }
  },
};
