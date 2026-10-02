import {
  decodePolyline,
  type PaymentMethod,
  type QuoteResponse,
  type VehicleCategory,
} from '@rideapp/contracts';
import {
  BaseMap,
  formatDistance,
  formatDuration,
  formatMoney,
  randomId,
  useSession,
} from '@rideapp/mobile-core';
import { Button, radius, spacing, usePalette } from '@rideapp/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Marker, Polyline } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { config } from '@/lib/config';
import { useTripDraft } from '@/lib/trip-draft';
import { isApiError, tripError } from '@/lib/trip-errors';

const CATEGORY: Record<VehicleCategory, { label: string; icon: string }> = {
  STANDARD: { label: 'Carro', icon: '🚗' },
  MOTO: { label: 'Moto', icon: '🏍️' },
};
const PAYMENT: Record<PaymentMethod, string> = { CASH: 'Efectivo', FAKE_CARD: 'Tarjeta (demo)' };

/** Segundos que faltan para que caduque la cotización, actualizados cada segundo. */
function useSecondsLeft(expiresAt: string | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  return expiresAt ? Math.max(0, Math.round((new Date(expiresAt).getTime() - now) / 1000)) : null;
}

/**
 * Ruta, precio y método de pago (9.3, pasos 4–5; 9.4, paso 1). El precio lo calcula el servidor;
 * la app solo envía el `quoteId`. Si la cotización caduca, se vuelve a cotizar sola.
 */
export default function ConfirmScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { api } = useSession();
  const queryClient = useQueryClient();
  const { origin, destination } = useTripDraft();
  const [category, setCategory] = useState<VehicleCategory>('STANDARD');
  const [payment, setPayment] = useState<PaymentMethod>('CASH');
  const [panelHeight, setPanelHeight] = useState(360);

  // Dirección de la recogida si vino del GPS (una consulta, cacheada en el servidor).
  const originAddress = useQuery({
    queryKey: ['geo', 'reverse', origin?.location.lat.toFixed(4), origin?.location.lng.toFixed(4)],
    queryFn: () => api.geo.reverse(origin!.location),
    enabled: !!origin && origin.address === null,
    retry: false,
    staleTime: Infinity,
  });
  const pickupLabel =
    origin?.address ?? originAddress.data?.formattedAddress ?? 'Tu ubicación actual';

  const quote = useQuery({
    queryKey: [
      'trips',
      'quote',
      origin?.location.lat,
      origin?.location.lng,
      destination?.location.lat,
      destination?.location.lng,
    ],
    queryFn: () =>
      api.trips.quote({
        origin: origin!.location,
        destination: destination!.location,
        destinationPlaceId: destination!.placeId,
        originAddress: pickupLabel,
        destinationAddress: destination!.address ?? undefined,
      }),
    enabled: !!origin && !!destination && !originAddress.isFetching,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  });
  const secondsLeft = useSecondsLeft(quote.data?.expiresAt);
  const expired = secondsLeft === 0;
  // Caducada: se vuelve a cotizar automáticamente (9.3, paso 5).
  const refetchQuote = quote.refetch;
  useEffect(() => {
    if (expired) void refetchQuote();
  }, [expired, refetchQuote]);

  // Una clave por cotización: reintentar el mismo pedido no lo duplica (8.8, paso 5).
  const idempotencyKey = useMemo(() => (quote.data ? randomId() : ''), [quote.data]);
  const option = quote.data?.options.find((o) => o.category === category);

  const request = useMutation({
    mutationFn: () =>
      api.trips.create({ quoteId: option!.quoteId, paymentMethod: payment }, idempotencyKey),
    onSuccess: (trip) => {
      queryClient.setQueryData(['trips', trip.id], trip);
      void queryClient.invalidateQueries({ queryKey: ['trips', 'active'] });
      router.dismissAll();
      router.replace(`/trip/${trip.id}`);
    },
    onError: async (err) => {
      if (isApiError(err, 'QUOTE_EXPIRED')) void refetchQuote();
      if (isApiError(err, 'ACTIVE_TRIP_EXISTS')) {
        const { trip } = await api.trips.active();
        if (trip) {
          router.dismissAll();
          router.replace(`/trip/${trip.id}`);
        }
      }
    },
  });

  const route = useMemo(() => routePoints(quote.data), [quote.data]);

  if (!origin || !destination) return <Redirect href="/" />;

  return (
    <View style={[styles.root, { backgroundColor: p.bg }]}>
      <BaseMap
        enabled={config.mapsEnabled}
        mapPadding={{ top: insets.top + 56, right: 0, bottom: panelHeight, left: 0 }}
        fitTo={route ?? [origin.location, destination.location]}
      >
        {route && <Polyline coordinates={toCoords(route)} strokeColor={p.accent} strokeWidth={5} />}
        <Marker
          coordinate={toCoord(origin.location)}
          title="Recogida"
          description={pickupLabel}
          pinColor="green"
        />
        <Marker
          coordinate={toCoord(destination.location)}
          title="Destino"
          description={destination.address ?? undefined}
        />
      </BaseMap>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Volver"
        onPress={() => router.back()}
        style={[
          styles.back,
          { top: insets.top + spacing.md, backgroundColor: p.surface, borderColor: p.border },
        ]}
      >
        <Text style={[styles.backIcon, { color: p.text }]}>←</Text>
      </Pressable>

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
        <View style={styles.places}>
          <Text style={[styles.place, { color: p.textMuted }]} numberOfLines={1}>
            ● {pickupLabel}
          </Text>
          <Text style={[styles.place, { color: p.text }]} numberOfLines={1}>
            ■ {destination.address ?? 'Punto en el mapa'}
          </Text>
        </View>

        {quote.isPending || (quote.isFetching && !quote.data) ? (
          <View style={styles.loading}>
            <ActivityIndicator color={p.accent} />
            <Text style={{ color: p.textMuted }}>Calculando la ruta y el precio…</Text>
          </View>
        ) : quote.isError ? (
          <View style={styles.loading}>
            <Text style={[styles.error, { color: p.down }]}>{tripError(quote.error)}</Text>
            <Button label="Reintentar" variant="secondary" onPress={() => void quote.refetch()} />
          </View>
        ) : (
          <>
            <Text style={[styles.meta, { color: p.textMuted }]}>
              {formatDistance(quote.data.distanceMeters)} ·{' '}
              {formatDuration(quote.data.durationSeconds)} aprox.
              {secondsLeft !== null && secondsLeft <= 60 && !expired
                ? ` · el precio vence en ${secondsLeft} s`
                : ''}
            </Text>
            <View style={styles.options} accessibilityRole="radiogroup">
              {quote.data.options.map((o) => {
                const selected = o.category === category;
                return (
                  <Pressable
                    key={o.category}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    onPress={() => setCategory(o.category)}
                    style={[
                      styles.option,
                      {
                        borderColor: selected ? p.accent : p.border,
                        backgroundColor: selected ? p.bg : p.surface,
                      },
                    ]}
                  >
                    <Text style={styles.optionIcon}>{CATEGORY[o.category].icon}</Text>
                    <Text style={[styles.optionLabel, { color: p.text }]}>
                      {CATEGORY[o.category].label}
                    </Text>
                    <Text style={[styles.optionPrice, { color: p.text }]}>
                      {formatMoney(o.amount)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.payments} accessibilityRole="radiogroup">
              {(Object.keys(PAYMENT) as PaymentMethod[]).map((m) => (
                <Pressable
                  key={m}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: payment === m }}
                  onPress={() => setPayment(m)}
                  style={[styles.payment, { borderColor: payment === m ? p.accent : p.border }]}
                >
                  <Text
                    style={{ color: payment === m ? p.accent : p.textMuted, fontWeight: '600' }}
                  >
                    {m === 'CASH' ? '💵' : '💳'} {PAYMENT[m]}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        {request.isError && (
          <Text accessibilityLiveRegion="polite" style={[styles.error, { color: p.down }]}>
            {tripError(request.error)}
          </Text>
        )}
        <Button
          label={
            option
              ? `Pedir ${CATEGORY[category].label.toLowerCase()} · ${formatMoney(option.amount)}`
              : 'Pedir viaje'
          }
          onPress={() => request.mutate()}
          loading={request.isPending}
          disabled={!option || expired || quote.isFetching}
        />
      </View>
    </View>
  );
}

function routePoints(quote: QuoteResponse | undefined) {
  if (!quote) return null;
  try {
    return decodePolyline(quote.polyline);
  } catch {
    return null;
  }
}

const toCoord = ({ lat, lng }: { lat: number; lng: number }) => ({
  latitude: lat,
  longitude: lng,
});
const toCoords = (points: { lat: number; lng: number }[]) => points.map(toCoord);

const styles = StyleSheet.create({
  root: { flex: 1 },
  back: {
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
  backIcon: { fontSize: 22 },
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
  places: { gap: 4 },
  place: { fontSize: 15 },
  loading: { gap: spacing.sm, alignItems: 'flex-start', minHeight: 120, justifyContent: 'center' },
  meta: { fontSize: 13 },
  options: { flexDirection: 'row', gap: spacing.md },
  option: {
    flex: 1,
    borderWidth: 2,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 2,
  },
  optionIcon: { fontSize: 22 },
  optionLabel: { fontSize: 15, fontWeight: '600' },
  optionPrice: { fontSize: 18, fontWeight: '700' },
  payments: { flexDirection: 'row', gap: spacing.sm },
  payment: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  error: { fontSize: 14 },
});
