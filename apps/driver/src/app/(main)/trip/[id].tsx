import type { LatLng, Trip } from '@rideapp/contracts';
import { BaseMap, formatMoney, randomId, useSession } from '@rideapp/mobile-core';
import { Button, radius, spacing, TextField, usePalette } from '@rideapp/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { config } from '@/lib/config';
import { driverError } from '@/lib/driver-account';
import { activeTripKey, tripKey } from '@/lib/trip-queries';

const PAYMENT = { CASH: 'Efectivo', FAKE_CARD: 'Tarjeta (demo)' } as const;
const ASSIGNED = new Set<Trip['status']>(['DRIVER_ASSIGNED', 'DRIVER_ARRIVED', 'IN_PROGRESS']);

/**
 * Abre la navegación del teléfono hacia un punto (10.3, paso 3): Google Maps por deep link, sin
 * integrar un SDK de navegación. Si no está instalada, el navegador abre la ruta.
 */
async function navigateTo({ lat, lng }: LatLng): Promise<void> {
  const native =
    Platform.OS === 'android'
      ? `google.navigation:q=${lat},${lng}&mode=d`
      : `comgooglemaps://?daddr=${lat},${lng}&directionsmode=driving`;
  const web = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
  try {
    await Linking.openURL(native);
  } catch {
    await Linking.openURL(web);
  }
}

const TITLE: Partial<Record<Trip['status'], string>> = {
  DRIVER_ARRIVED: 'Esperando al pasajero',
  IN_PROGRESS: 'En viaje',
  COMPLETED: 'Viaje terminado',
};

/**
 * Viaje asignado (10.3). Flujo de botones: Llegué → PIN del pasajero → Iniciar → Finalizar. Cada
 * paso lo valida el servidor (cerca de la recogida, PIN correcto, orden de la máquina de estados).
 */
export default function DriverTripScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { api } = useSession();
  const queryClient = useQueryClient();
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const [panelHeight, setPanelHeight] = useState(300);

  // El socket (en la pantalla de inicio) invalida esta consulta con cada `trip.status.v1`;
  // además se consulta cada 15 s por si se pierde un evento.
  const trip = useQuery({
    queryKey: tripKey(id),
    queryFn: () => api.trips.get(id),
    refetchInterval: (q) => (q.state.data && ASSIGNED.has(q.state.data.status) ? 15_000 : false),
  });

  const [pin, setPin] = useState('');
  // Una clave por pantalla: si "Finalizar" se reintenta por mala conexión, no se repite (8.8, paso 5).
  const [completeKey] = useState(randomId);

  const onUpdated = (updated: Trip) => {
    queryClient.setQueryData(tripKey(id), updated);
    void queryClient.invalidateQueries({ queryKey: activeTripKey });
  };
  const arrived = useMutation({ mutationFn: () => api.trips.arrived(id), onSuccess: onUpdated });
  const start = useMutation({
    mutationFn: () => api.trips.start(id, pin),
    onSuccess: onUpdated,
    onError: () => setPin(''),
  });
  const complete = useMutation({
    mutationFn: () => api.trips.complete(id, completeKey),
    onSuccess: onUpdated,
  });

  const askComplete = () =>
    Alert.alert('¿Finalizar el viaje?', 'Hazlo cuando el pasajero se haya bajado.', [
      { text: 'Todavía no', style: 'cancel' },
      { text: 'Finalizar', onPress: () => complete.mutate() },
    ]);

  const cancel = useMutation({
    mutationFn: () => api.trips.cancel(id, 'Cancelado por el conductor'),
    onSuccess: (updated) => {
      queryClient.setQueryData(tripKey(id), updated);
      void queryClient.invalidateQueries({ queryKey: activeTripKey });
    },
  });

  const askCancel = () =>
    Alert.alert(
      '¿Cancelar el viaje?',
      'El pasajero tendrá que pedir otro conductor. Cancelar seguido afecta tu cuenta.',
      [
        { text: 'No', style: 'cancel' },
        { text: 'Sí, cancelar', style: 'destructive', onPress: () => cancel.mutate() },
      ],
    );

  const goHome = () => {
    void queryClient.invalidateQueries({ queryKey: activeTripKey });
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

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
        <Text style={[styles.text, { color: p.down }]}>{driverError(trip.error)}</Text>
        <Button label="Volver" variant="secondary" onPress={goHome} />
      </View>
    );
  }
  const t = trip.data;
  const assigned = ASSIGNED.has(t.status);
  const riding = t.status === 'IN_PROGRESS';
  const toCoord = ({ lat, lng }: LatLng) => ({ latitude: lat, longitude: lng });
  const actionError = [arrived, start, complete, cancel].find((m) => m.isError)?.error;

  return (
    <View style={[styles.root, { backgroundColor: p.bg }]}>
      <BaseMap
        enabled={config.mapsEnabled}
        showsUserLocation
        mapPadding={{ top: insets.top, right: 0, bottom: panelHeight, left: 0 }}
        fitTo={[t.origin, t.destination]}
      >
        {!riding && <Marker coordinate={toCoord(t.origin)} title="Recogida" pinColor="green" />}
        <Marker coordinate={toCoord(t.destination)} title="Destino" />
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
        <Text accessibilityLiveRegion="polite" style={[styles.title, { color: p.text }]}>
          {TITLE[t.status] ??
            (assigned
              ? `Recoge a ${t.passenger?.fullName ?? 'tu pasajero'}`
              : t.status === 'CANCELLED'
                ? t.cancelledBy === 'PASSENGER'
                  ? 'El pasajero canceló el viaje'
                  : 'Viaje cancelado'
                : 'Este viaje ya terminó')}
        </Text>

        {t.status === 'COMPLETED' ? (
          <View style={[styles.receipt, { borderColor: p.border }]}>
            <Text style={[styles.text, { color: p.textMuted }]}>
              {t.paymentMethod === 'CASH' ? 'Cobra en efectivo' : 'Pagado con tarjeta (demo)'}
            </Text>
            <Text style={[styles.total, { color: p.text }]}>{formatMoney(t.amount)}</Text>
          </View>
        ) : (
          <>
            <View style={styles.places}>
              <Text style={[styles.text, { color: riding ? p.textMuted : p.text }]}>
                ● {t.originAddress ?? 'Punto de recogida en el mapa'}
              </Text>
              <Text style={[styles.text, { color: riding ? p.text : p.textMuted }]}>
                ■ {t.destinationAddress ?? 'Destino en el mapa'}
              </Text>
            </View>
            <Text style={[styles.price, { color: p.text }]}>
              {formatMoney(t.amount)} · {PAYMENT[t.paymentMethod]}
            </Text>
          </>
        )}

        {actionError && (
          <Text accessibilityLiveRegion="polite" style={[styles.text, { color: p.down }]}>
            {driverError(actionError)}
          </Text>
        )}

        {t.status === 'DRIVER_ASSIGNED' && (
          <>
            <Button label="Llegué" onPress={() => arrived.mutate()} loading={arrived.isPending} />
            <Button
              label="Navegar a la recogida"
              variant="secondary"
              onPress={() => void navigateTo(t.origin)}
            />
          </>
        )}
        {t.status === 'DRIVER_ARRIVED' && (
          <>
            <TextField
              label={`PIN de ${t.passenger?.fullName ?? 'tu pasajero'}`}
              hint="Pídele los 4 dígitos que ve en su app"
              value={pin}
              onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 4))}
              keyboardType="number-pad"
              maxLength={4}
              autoComplete="off"
              textContentType="oneTimeCode"
              style={styles.pinInput}
            />
            <Button
              label="Iniciar viaje"
              onPress={() => start.mutate()}
              disabled={pin.length !== 4}
              loading={start.isPending}
            />
          </>
        )}
        {riding && (
          <>
            <Button label="Finalizar viaje" onPress={askComplete} loading={complete.isPending} />
            <Button
              label="Navegar al destino"
              variant="secondary"
              onPress={() => void navigateTo(t.destination)}
            />
          </>
        )}
        {(t.status === 'DRIVER_ASSIGNED' || t.status === 'DRIVER_ARRIVED') && (
          <Button
            label={t.status === 'DRIVER_ARRIVED' ? 'El pasajero no llegó' : 'Cancelar viaje'}
            variant="ghost"
            onPress={askCancel}
            loading={cancel.isPending}
          />
        )}
        {!assigned && (
          <Button
            label={t.status === 'COMPLETED' ? 'Listo' : 'Volver'}
            variant="secondary"
            onPress={goHome}
          />
        )}
      </View>
    </View>
  );
}

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
  title: { fontSize: 21, fontWeight: '700' },
  places: { gap: 4 },
  text: { fontSize: 15, lineHeight: 21 },
  price: { fontSize: 18, fontWeight: '700' },
  receipt: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  total: { fontSize: 28, fontWeight: '800' },
  pinInput: { fontSize: 24, letterSpacing: 8, textAlign: 'center' },
});
