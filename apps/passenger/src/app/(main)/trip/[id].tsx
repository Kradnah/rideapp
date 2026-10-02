import {
  type ActiveTripResponse,
  decodePolyline,
  type LatLng,
  remainingPath,
  routeProgress,
  type Trip,
  type TripDriverLocation,
  type TripStatusV1,
} from '@rideapp/contracts';
import {
  BaseMap,
  formatDuration,
  formatMoney,
  useSession,
  useSmoothPosition,
} from '@rideapp/mobile-core';
import { Button, radius, spacing, usePalette } from '@rideapp/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, StyleSheet, Text, View } from 'react-native';
import { Marker, Polyline } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { config } from '@/lib/config';
import { tripError } from '@/lib/trip-errors';
import { usePassengerSocket } from '@/lib/use-passenger-socket';

const ACTIVE = new Set<Trip['status']>([
  'REQUESTED',
  'SEARCHING',
  'DRIVER_ASSIGNED',
  'DRIVER_ARRIVED',
  'IN_PROGRESS',
]);
/** Con conductor asignado: hay posición en vivo. */
const BUSY = new Set<Trip['status']>(['DRIVER_ASSIGNED', 'DRIVER_ARRIVED', 'IN_PROGRESS']);
const CANCELLABLE = new Set<Trip['status']>([
  'REQUESTED',
  'SEARCHING',
  'DRIVER_ASSIGNED',
  'DRIVER_ARRIVED',
]);

const TITLE: Record<Trip['status'], string> = {
  REQUESTED: 'Pidiendo tu viaje…',
  SEARCHING: 'Buscando conductor…',
  NO_DRIVERS: 'No encontramos conductores',
  DRIVER_ASSIGNED: 'Tu conductor va en camino',
  DRIVER_ARRIVED: 'Tu conductor llegó',
  IN_PROGRESS: 'En viaje',
  COMPLETED: 'Llegaste a tu destino',
  CANCELLED: 'Viaje cancelado',
};

/**
 * Viaje en curso (9.4). Se pinta siempre con el estado del servidor: el socket avisa del cambio
 * (`trip.status.v1`) y la app vuelve a leer el viaje; sin socket, consulta cada pocos segundos.
 * Con conductor asignado, su posición llega por el socket (`trip.driverLocation.v1`) con el ETA
 * ya calculado en el servidor, y el marcador se interpola entre actualizaciones.
 */
export default function TripScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { api } = useSession();
  const queryClient = useQueryClient();
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const [panelHeight, setPanelHeight] = useState(260);

  const trip = useQuery({
    queryKey: ['trips', id],
    queryFn: () => api.trips.get(id),
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      if (!status || !ACTIVE.has(status)) return false;
      return status === 'SEARCHING' ? 5_000 : 15_000;
    },
  });
  const status = trip.data?.status;
  const active = !!status && ACTIVE.has(status);
  const busy = !!status && BUSY.has(status);

  // Última posición del conductor: la del socket o, al abrir la pantalla, la que guarda el API.
  const [socketLocation, setSocketLocation] = useState<TripDriverLocation | null>(null);
  const savedLocation = useQuery({
    queryKey: ['trips', id, 'driver-location'],
    queryFn: () => api.trips.driverLocation(id),
    enabled: busy,
    staleTime: Infinity,
  });
  const live = busy ? newest(socketLocation, savedLocation.data?.location ?? null) : null;

  // Dónde estaba el conductor al cambiar de estado: encuadre del mapa (no se mueve con cada posición).
  const [anchor, setAnchor] = useState<{ status: Trip['status']; position: LatLng } | null>(null);
  if (live && status && anchor?.status !== status) {
    setAnchor({ status, position: live.position });
  }

  const onStatus = useCallback(
    (e: TripStatusV1) => {
      if (e.tripId !== id) return;
      void queryClient.invalidateQueries({ queryKey: ['trips', id] });
      void queryClient.invalidateQueries({ queryKey: ['trips', 'active'] });
    },
    [id, queryClient],
  );
  const onDriverLocation = useCallback(
    (e: TripDriverLocation) => {
      if (e.tripId === id) setSocketLocation(e);
    },
    [id],
  );
  usePassengerSocket(active, onStatus, onDriverLocation);

  const cancel = useMutation({
    mutationFn: () => api.trips.cancel(id),
    onSuccess: (updated) => {
      queryClient.setQueryData(['trips', id], updated);
      void queryClient.invalidateQueries({ queryKey: ['trips', 'active'] });
    },
  });

  const askCancel = () =>
    Alert.alert(
      '¿Cancelar el viaje?',
      status === 'SEARCHING'
        ? 'Dejaremos de buscarte conductor.'
        : 'Tu conductor ya va en camino. ¿Seguro que quieres cancelar?',
      [
        { text: 'No', style: 'cancel' },
        { text: 'Sí, cancelar', style: 'destructive', onPress: () => cancel.mutate() },
      ],
    );

  const goHome = () => {
    // Este viaje ya terminó: si el inicio leyera el "viaje activo" viejo de la caché, volvería aquí.
    queryClient.setQueryData<ActiveTripResponse>(['trips', 'active'], { trip: null });
    void queryClient.invalidateQueries({ queryKey: ['trips', 'active'] });
    router.replace('/');
  };

  const route = useMemo(() => {
    if (!trip.data) return null;
    try {
      return decodePolyline(trip.data.polyline);
    } catch {
      return [trip.data.origin, trip.data.destination];
    }
  }, [trip.data]);

  // En viaje, solo la parte de la ruta que falta (cambia con cada posición, cada ~5 s).
  const livePosition = live?.position ?? null;
  const pending =
    route && status === 'IN_PROGRESS' && livePosition && route.length > 0
      ? remainingPath(route, routeProgress(route, livePosition))
      : route;

  const originLat = trip.data?.origin.lat;
  const originLng = trip.data?.origin.lng;
  const pickup = useMemo(
    () =>
      originLat === undefined || originLng === undefined
        ? null
        : { lat: originLat, lng: originLng },
    [originLat, originLng],
  );
  const fitTo = useMemo(() => {
    if (status === 'DRIVER_ASSIGNED' && pickup && anchor?.status === status) {
      return [anchor.position, pickup];
    }
    // Al llegar se conserva el encuadre del acercamiento (conductor y recogida).
    if (status === 'DRIVER_ARRIVED') return null;
    return route;
  }, [status, pickup, anchor, route]);

  if (trip.isPending) {
    return (
      <View style={[styles.center, { backgroundColor: p.bg }]}>
        <ActivityIndicator color={p.accent} size="large" />
      </View>
    );
  }
  if (trip.isError) {
    return (
      <View style={[styles.center, { backgroundColor: p.bg, padding: spacing.xl }]}>
        <Text style={[styles.error, { color: p.down }]}>{tripError(trip.error)}</Text>
        <Button label="Volver al inicio" variant="secondary" onPress={goHome} />
      </View>
    );
  }
  const t = trip.data;

  return (
    <View style={[styles.root, { backgroundColor: p.bg }]}>
      <BaseMap
        enabled={config.mapsEnabled}
        mapPadding={{ top: insets.top, right: 0, bottom: panelHeight, left: 0 }}
        fitTo={fitTo}
      >
        {pending && (
          <Polyline coordinates={toCoords(pending)} strokeColor={p.accent} strokeWidth={5} />
        )}
        {t.status !== 'IN_PROGRESS' && (
          <Marker coordinate={toCoord(t.origin)} title="Recogida" pinColor="green" />
        )}
        <Marker coordinate={toCoord(t.destination)} title="Destino" />
        <DriverMarker
          target={livePosition}
          title={t.driver ? `${t.driver.fullName} · ${t.driver.vehicle.plate}` : 'Tu conductor'}
        />
      </BaseMap>

      <View
        onLayout={(e) => setPanelHeight(e.nativeEvent.layout.height)}
        style={[
          styles.panel,
          {
            backgroundColor: p.surface,
            borderColor: p.border,
            paddingBottom: insets.bottom + spacing.lg,
          },
        ]}
      >
        <View style={styles.titleRow}>
          {t.status === 'SEARCHING' && <ActivityIndicator color={p.accent} />}
          <Text accessibilityLiveRegion="polite" style={[styles.title, { color: p.text }]}>
            {TITLE[t.status]}
          </Text>
        </View>

        {t.status === 'SEARCHING' && (
          <Text style={[styles.text, { color: p.textMuted }]}>
            Estamos ofreciendo tu viaje a los conductores más cercanos. Suele tardar menos de un
            minuto.
          </Text>
        )}

        {t.status === 'DRIVER_ASSIGNED' && (
          <Text style={[styles.eta, { color: p.text }]}>
            {live?.etaSeconds != null
              ? `Llega en ${formatDuration(live.etaSeconds)}`
              : 'Calculando cuándo llega…'}
          </Text>
        )}
        {t.status === 'DRIVER_ARRIVED' && (
          <Text style={[styles.text, { color: p.textMuted }]}>
            Te está esperando en el punto de recogida. Busca la placa del vehículo.
          </Text>
        )}
        {t.status === 'IN_PROGRESS' && live?.etaSeconds != null && (
          <Text style={[styles.eta, { color: p.text }]}>
            Llegas en {formatDuration(live.etaSeconds)}
          </Text>
        )}

        {t.driver && ACTIVE.has(t.status) && (
          <View style={[styles.driver, { borderColor: p.border }]}>
            <View style={styles.flex}>
              <Text style={[styles.driverName, { color: p.text }]}>{t.driver.fullName}</Text>
              <Text style={[styles.text, { color: p.textMuted }]}>
                {t.driver.vehicle.brand} {t.driver.vehicle.model} · {t.driver.vehicle.color}
              </Text>
            </View>
            <Text style={[styles.plate, { color: p.text, borderColor: p.text }]}>
              {t.driver.vehicle.plate}
            </Text>
          </View>
        )}

        {t.pin && (t.status === 'DRIVER_ASSIGNED' || t.status === 'DRIVER_ARRIVED') && (
          <View style={styles.pinRow}>
            <Text style={[styles.text, { color: p.textMuted }]}>
              Dile este PIN al conductor para empezar el viaje
            </Text>
            <Text
              accessibilityLabel={`PIN ${t.pin.split('').join(' ')}`}
              style={[styles.pin, { color: p.text }]}
            >
              {t.pin}
            </Text>
          </View>
        )}

        {t.status === 'COMPLETED' && (
          <View style={[styles.receipt, { borderColor: p.border }]}>
            <Text style={[styles.text, { color: p.textMuted }]}>Total del viaje</Text>
            <Text style={[styles.total, { color: p.text }]}>{formatMoney(t.amount)}</Text>
            <Text style={[styles.text, { color: p.textMuted }]}>
              {t.paymentMethod === 'CASH'
                ? 'Paga en efectivo a tu conductor.'
                : 'Se cobra a tu tarjeta demo (no es un cobro real).'}
            </Text>
          </View>
        )}

        {t.status === 'NO_DRIVERS' && (
          <Text style={[styles.text, { color: p.textMuted }]}>
            Todos los conductores cercanos están ocupados. Inténtalo de nuevo en unos minutos.
          </Text>
        )}
        {t.status === 'CANCELLED' && (
          <Text style={[styles.text, { color: p.textMuted }]}>
            {t.cancelledBy === 'DRIVER'
              ? 'El conductor canceló el viaje. No se te cobrará nada.'
              : t.cancelledBy === 'SYSTEM'
                ? 'El viaje se canceló automáticamente.'
                : 'Cancelaste el viaje.'}
          </Text>
        )}

        {t.status !== 'COMPLETED' && (
          <Text style={[styles.text, { color: p.textMuted }]} numberOfLines={1}>
            ■ {t.destinationAddress ?? 'Destino en el mapa'} · {formatMoney(t.amount)}
          </Text>
        )}

        {cancel.isError && (
          <Text style={[styles.error, { color: p.down }]}>{tripError(cancel.error)}</Text>
        )}

        {CANCELLABLE.has(t.status) && (
          <Button
            label="Cancelar viaje"
            variant="danger"
            onPress={askCancel}
            loading={cancel.isPending}
          />
        )}
        {t.status !== 'SEARCHING' && active && (
          <Button
            label="Emergencia · Línea 123"
            variant="ghost"
            onPress={() => void Linking.openURL('tel:123')}
            accessibilityHint="Llama a la línea única de emergencias"
          />
        )}
        {t.status === 'NO_DRIVERS' && (
          <Button label="Intentar de nuevo" onPress={() => router.replace('/confirm')} />
        )}
        {!active && <Button label="Volver al inicio" variant="secondary" onPress={goHome} />}
      </View>
    </View>
  );
}

/**
 * Marcador del conductor, interpolado entre posiciones. Va en su propio componente para que solo
 * él se vuelva a pintar en cada fotograma, no toda la pantalla (ni el mapa).
 */
function DriverMarker({ target, title }: { target: LatLng | null; title: string }) {
  const position = useSmoothPosition(target);
  if (!position) return null;
  return <Marker coordinate={toCoord(position)} title={title} pinColor="azure" />;
}

/** La posición más reciente (por la hora del GPS) entre la del socket y la guardada. */
function newest(
  a: TripDriverLocation | null,
  b: TripDriverLocation | null,
): TripDriverLocation | null {
  if (!a) return b;
  if (!b) return a;
  return a.ts >= b.ts ? a : b;
}

const toCoord = ({ lat, lng }: { lat: number; lng: number }) => ({
  latitude: lat,
  longitude: lng,
});
const toCoords = (points: { lat: number; lng: number }[]) => points.map(toCoord);

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    gap: spacing.md,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { fontSize: 22, fontWeight: '700', flexShrink: 1 },
  text: { fontSize: 14, lineHeight: 20 },
  error: { fontSize: 14 },
  driver: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  flex: { flex: 1 },
  driverName: { fontSize: 17, fontWeight: '700' },
  plate: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 1,
    borderWidth: 2,
    borderRadius: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  eta: { fontSize: 17, fontWeight: '600' },
  receipt: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  total: { fontSize: 28, fontWeight: '800' },
  pinRow: { gap: 2 },
  pin: { fontSize: 32, fontWeight: '800', letterSpacing: 8 },
});
