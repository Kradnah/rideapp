import { ApiClientError } from '@rideapp/api-client';
import {
  type DriverAvailabilityV1,
  type DriverOffer,
  LOCATION_INTERVAL_SECONDS,
  type TripOfferCancelledV1,
  type TripStatusV1,
} from '@rideapp/contracts';
import { BaseMap, colors, radius, spacing, useSession } from '@rideapp/mobile-core';
import { Button } from '@rideapp/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { Redirect, router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { config } from '@/lib/config';
import { DRIVER_ACCOUNT_KEY, driverError, useDriverAccount } from '@/lib/driver-account';
import { locationReporter, type ReporterMode } from '@/lib/location-reporter';
import { OfferCard } from '@/components/OfferCard';
import { activeTripKey, TRIPS_KEY, tripKey } from '@/lib/trip-queries';
import { useDriverSocket } from '@/lib/use-driver-socket';

const INACTIVE_MESSAGE = 'Te desconectamos porque no recibimos tu ubicación. Vuelve a conectarte.';

const OFFER_GONE: Record<TripOfferCancelledV1['reason'], string> = {
  EXPIRED: 'La solicitud caducó sin respuesta.',
  CANCELLED: 'El pasajero canceló la solicitud.',
  TAKEN: 'Otro conductor tomó el viaje.',
};

/** Pide los permisos explicando antes para qué (9.2, paso 2; 10.2). */
async function askLocationPermissions(): Promise<'background' | 'foreground' | 'denied'> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return 'denied';
  const bg = await Location.getBackgroundPermissionsAsync();
  if (bg.granted) return 'background';
  if (!bg.canAskAgain) return 'foreground';
  const wants = await new Promise<boolean>((resolve) =>
    Alert.alert(
      'Seguir en línea con la pantalla apagada',
      'Para recibir viajes aunque uses otra app o bloquees el teléfono, permite la ubicación "Todo el tiempo". Solo la usamos mientras estás en línea y verás una notificación fija.',
      [
        { text: 'Ahora no', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Permitir', onPress: () => resolve(true) },
      ],
    ),
  );
  if (!wants) return 'foreground';
  return (await Location.requestBackgroundPermissionsAsync()).granted ? 'background' : 'foreground';
}

/** Mapa + interruptor En línea / Fuera de línea (10.2). */
export default function DriverHomeScreen() {
  const palette = colors[useColorScheme() === 'dark' ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const { api } = useSession();
  const queryClient = useQueryClient();
  const account = useDriverAccount();
  const [panelHeight, setPanelHeight] = useState(180);

  /** null = seguir lo que diga el servidor (al abrir la app se retoma si quedó en línea). */
  const [wantOnline, setWantOnline] = useState<boolean | null>(null);
  const [interval, setIntervalSeconds] = useState(12);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [mode, setMode] = useState<ReporterMode | null>(null);
  const [lastSent, setLastSent] = useState<number | null>(null);

  const serverOnline = account.data !== undefined && account.data.availability !== 'OFFLINE';
  const online = wantOnline ?? serverOnline;

  const forceOffline = useCallback(
    (text: string) => {
      setWantOnline(false);
      setMessage(text);
      void locationReporter.stop();
      // Si el servidor aún nos tiene en línea (p. ej. faltó el permiso al retomar), se corrige.
      void api.drivers
        .goOffline()
        .catch(() => undefined)
        .finally(() => void queryClient.invalidateQueries({ queryKey: DRIVER_ACCOUNT_KEY }));
    },
    [api, queryClient],
  );

  const onAvailability = useCallback(
    (e: DriverAvailabilityV1) => {
      if (e.availability !== 'OFFLINE') return;
      forceOffline(
        e.reason === 'SUSPENDED'
          ? 'Tu cuenta fue suspendida. Revisa el motivo en tu registro.'
          : INACTIVE_MESSAGE,
      );
    },
    [forceOffline],
  );

  // ---------- Ofertas de viaje (10.3) ----------
  const [offer, setOffer] = useState<DriverOffer | null>(null);
  const [offerBusy, setOfferBusy] = useState<'accept' | 'reject' | null>(null);
  const offerRef = useRef(offer);
  useEffect(() => {
    offerRef.current = offer;
  }, [offer]);

  const activeTrip = useQuery({
    queryKey: activeTripKey,
    queryFn: () => api.trips.active(),
    enabled: account.data?.status === 'APPROVED',
  });
  const currentTrip = activeTrip.data?.trip ?? null;

  const handlers = useMemo(
    () => ({
      onAvailability,
      onOffer: (e: DriverOffer) => {
        setMessage(null);
        setOffer(e);
      },
      onOfferCancelled: (e: TripOfferCancelledV1) => {
        if (offerRef.current?.tripId !== e.tripId) return;
        setOffer(null);
        setMessage(OFFER_GONE[e.reason]);
      },
      onTripStatus: (_e: TripStatusV1) => {
        void queryClient.invalidateQueries({ queryKey: TRIPS_KEY });
      },
      // Al (re)conectar se recupera la oferta que pudo llegar mientras no había socket.
      onConnect: () => {
        void api.drivers.offer().then(
          (res) => setOffer(res.offer),
          () => undefined,
        );
        void queryClient.invalidateQueries({ queryKey: TRIPS_KEY });
      },
    }),
    [api, onAvailability, queryClient],
  );

  const { socket, connected } = useDriverSocket(online, handlers);

  // Si se perdió el aviso de caducidad, la oferta se retira sola poco después de vencer.
  useEffect(() => {
    if (!offer) return;
    const ms = new Date(offer.expiresAt).getTime() - Date.now() + 3_000;
    const timer = setTimeout(() => setOffer(null), Math.max(0, ms));
    return () => clearTimeout(timer);
  }, [offer]);

  const acceptOffer = async () => {
    if (!offer) return;
    setOfferBusy('accept');
    try {
      const trip = await api.trips.accept(offer.tripId);
      setOffer(null);
      queryClient.setQueryData(tripKey(trip.id), trip);
      void queryClient.invalidateQueries({ queryKey: activeTripKey });
      router.push(`/trip/${trip.id}`);
    } catch (err) {
      setOffer(null);
      setMessage(
        err instanceof ApiClientError && err.status === 409
          ? 'Este viaje ya no está disponible.'
          : driverError(err),
      );
    } finally {
      setOfferBusy(null);
    }
  };

  const rejectOffer = async () => {
    if (!offer) return;
    setOfferBusy('reject');
    try {
      await api.trips.reject(offer.tripId);
    } catch {
      // Si ya caducó o se canceló, da igual: se retira de la pantalla.
    } finally {
      setOffer(null);
      setOfferBusy(null);
    }
  };

  // Con el socket listo, se empieza a enviar la ubicación; al salir de línea, se para todo.
  // En viaje, más a menudo: el pasajero lo sigue en el mapa (10.2, paso 3).
  const reportEvery = currentTrip ? LOCATION_INTERVAL_SECONDS.inTrip : interval;
  useEffect(() => {
    if (!socket) return;
    let cancelled = false;
    locationReporter.start(socket, reportEvery).then(
      (m) => !cancelled && setMode(m),
      () => !cancelled && forceOffline('Sin permiso de ubicación no puedes estar en línea.'),
    );
    const unsubscribe = locationReporter.subscribe((e) => {
      if (e.type === 'sent') setLastSent(e.at);
      if (e.type === 'offline') forceOffline(INACTIVE_MESSAGE);
    });
    return () => {
      cancelled = true;
      unsubscribe();
      void locationReporter.stop();
      setMode(null);
    };
  }, [socket, reportEvery, forceOffline]);

  const goOnline = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const permission = await askLocationPermissions();
      if (permission === 'denied') {
        setMessage('Necesitamos tu ubicación para ofrecerte viajes cercanos.');
        Alert.alert('Ubicación desactivada', 'Actívala en los ajustes para ponerte en línea.', [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Abrir ajustes', onPress: () => void Linking.openSettings() },
        ]);
        return;
      }
      const res = await api.drivers.goOnline();
      setIntervalSeconds(res.locationIntervalSeconds);
      setWantOnline(true);
    } catch (err) {
      setMessage(driverError(err));
    } finally {
      setBusy(false);
    }
  };

  const goOffline = async () => {
    setBusy(true);
    setMessage(null);
    await locationReporter.stop();
    setWantOnline(false);
    try {
      await api.drivers.goOffline();
    } catch (err) {
      setMessage(driverError(err));
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries({ queryKey: DRIVER_ACCOUNT_KEY });
    }
  };

  const notDriver = account.error instanceof ApiClientError && account.error.status === 403;
  if (notDriver || (account.data && account.data.status !== 'APPROVED')) {
    return <Redirect href="/onboarding" />;
  }

  const status = !online
    ? null
    : !connected
      ? 'Conectando con el servidor…'
      : lastSent
        ? `Ubicación enviada a las ${new Date(lastSent).toLocaleTimeString('es-CO')}`
        : 'Esperando tu ubicación…';

  return (
    <View style={[styles.root, { backgroundColor: palette.bg }]}>
      <BaseMap
        enabled={config.mapsEnabled}
        showsUserLocation={online}
        mapPadding={{ top: insets.top, right: 0, bottom: panelHeight, left: 0 }}
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Perfil"
        onPress={() => router.push('/profile')}
        style={[
          styles.profileButton,
          {
            top: insets.top + spacing.md,
            backgroundColor: palette.surface,
            borderColor: palette.border,
          },
        ]}
      >
        <Text style={[styles.profileIcon, { color: palette.text }]}>☰</Text>
      </Pressable>

      <View
        onLayout={(e) => setPanelHeight(e.nativeEvent.layout.height)}
        style={[
          styles.panel,
          {
            backgroundColor: palette.surface,
            borderColor: palette.border,
            paddingBottom: insets.bottom + spacing.lg,
          },
        ]}
      >
        {offer && (
          <OfferCard
            offer={offer}
            busy={offerBusy}
            onAccept={() => void acceptOffer()}
            onReject={() => void rejectOffer()}
          />
        )}
        {currentTrip && (
          <Button
            label="Tienes un viaje en curso · Ver"
            onPress={() => router.push(`/trip/${currentTrip.id}`)}
          />
        )}
        <View style={styles.row}>
          <View style={styles.flex}>
            <Text style={[styles.title, { color: palette.text }]}>
              {online ? 'Estás en línea' : 'Estás fuera de línea'}
            </Text>
            <Text style={[styles.subtitle, { color: palette.textMuted }]}>
              {online
                ? 'Recibirás solicitudes de viaje cercanas.'
                : 'Conéctate para empezar a recibir viajes.'}
            </Text>
          </View>
          {busy || account.isPending ? (
            <ActivityIndicator color={palette.accent} />
          ) : (
            <Switch
              accessibilityLabel="En línea"
              value={online}
              onValueChange={(v) => void (v ? goOnline() : goOffline())}
              trackColor={{ true: palette.accent, false: palette.border }}
            />
          )}
        </View>
        {status && (
          <View style={styles.row}>
            <View
              style={[styles.dot, { backgroundColor: connected ? palette.ok : palette.pending }]}
            />
            <Text style={[styles.status, { color: palette.textMuted }]}>{status}</Text>
          </View>
        )}
        {online && mode === 'foreground' && (
          <Text style={[styles.notice, { color: palette.pending }]}>
            Mantén la app abierta: sin permiso de ubicación "Todo el tiempo" dejamos de recibirla al
            salir de la app.
          </Text>
        )}
        {message && (
          <Text accessibilityLiveRegion="polite" style={[styles.notice, { color: palette.down }]}>
            {message}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  profileButton: {
    position: 'absolute',
    left: spacing.lg,
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
  },
  profileIcon: { fontSize: 20, fontWeight: '600' },
  flex: { flex: 1 },
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
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { fontSize: 20, fontWeight: '700' },
  subtitle: { fontSize: 14, marginTop: 2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  status: { fontSize: 13 },
  notice: { fontSize: 13, lineHeight: 18 },
});
