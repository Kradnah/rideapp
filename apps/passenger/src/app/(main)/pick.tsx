import { GIRARDOT_CENTER, isInServiceAreaBounds, type LatLng } from '@rideapp/contracts';
import { BaseMap, useSession } from '@rideapp/mobile-core';
import { Button, radius, spacing, usePalette } from '@rideapp/ui';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { config } from '@/lib/config';
import { useTripDraft } from '@/lib/trip-draft';
import { tripError } from '@/lib/trip-errors';

/** La dirección se pide solo cuando el mapa lleva 800 ms quieto (9.3, paso 2). */
const SETTLE_MS = 800;
const PIN_SIZE = 40;

/**
 * "Fijar en el mapa" (9.3, paso 2): un pin fijo en el centro y el mapa se mueve debajo. Sirve
 * para la recogida (sin GPS o para corregirla) y para destinos que el buscador no encuentra.
 */
export default function PickScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { api } = useSession();
  const draft = useTripDraft();
  const { target } = useLocalSearchParams<{ target?: string }>();
  const isOrigin = target !== 'destination';
  const current = isOrigin ? draft.origin : draft.destination;

  const [start] = useState<LatLng>(
    () => current?.location ?? draft.origin?.location ?? GIRARDOT_CENTER,
  );
  const [center, setCenter] = useState<LatLng>(start);
  const [settled, setSettled] = useState<LatLng>(start);
  const [size, setSize] = useState({ height: 0, panel: 220 });

  useEffect(() => {
    const timer = setTimeout(() => setSettled(center), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [center]);

  const inArea = isInServiceAreaBounds(settled);
  // Clave redondeada a ~11 m, igual que la caché del servidor.
  const address = useQuery({
    queryKey: ['geo', 'reverse', settled.lat.toFixed(4), settled.lng.toFixed(4)],
    queryFn: () => api.geo.reverse(settled),
    enabled: inArea,
    retry: false,
    staleTime: Infinity,
  });

  const moving = center !== settled;
  const label = !inArea
    ? 'Fuera de la zona de servicio (Girardot, Ricaurte y Flandes).'
    : moving || address.isFetching
      ? 'Buscando la dirección…'
      : address.isError
        ? tripError(address.error)
        : (address.data?.formattedAddress ?? 'Punto en el mapa');

  const confirm = () => {
    const place = {
      location: settled,
      address: address.data?.formattedAddress ?? null,
    };
    if (isOrigin) draft.setOrigin(place);
    else draft.setDestination(place);
    // Si ya están los dos puntos, a confirmar; si no, de vuelta a la búsqueda.
    const origin = isOrigin ? place : draft.origin;
    const destination = isOrigin ? draft.destination : place;
    if (origin && destination) router.replace('/confirm');
    else router.back();
  };

  // El pin va en el centro del área visible (sin el panel), que es el centro de la cámara.
  const pinTop = insets.top + (size.height - insets.top - size.panel) / 2 - PIN_SIZE;

  return (
    <View
      style={[styles.root, { backgroundColor: p.bg }]}
      onLayout={(e) => setSize((s) => ({ ...s, height: e.nativeEvent.layout.height }))}
    >
      <BaseMap
        enabled={config.mapsEnabled}
        center={start}
        mapPadding={{ top: insets.top, right: 0, bottom: size.panel, left: 0 }}
        onRegionChangeComplete={setCenter}
      />
      {size.height > 0 && (
        <View pointerEvents="none" style={[styles.pin, { top: pinTop }]}>
          <Text style={[styles.pinIcon, { color: isOrigin ? p.accent : p.text }]}>📍</Text>
        </View>
      )}

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
        onLayout={(e) => setSize((s) => ({ ...s, panel: e.nativeEvent.layout.height }))}
        style={[
          styles.panel,
          {
            backgroundColor: p.surface,
            borderColor: p.border,
            paddingBottom: insets.bottom + spacing.lg,
          },
        ]}
      >
        <Text style={[styles.title, { color: p.text }]}>
          {isOrigin ? '¿Dónde te recogemos?' : '¿A dónde vas?'}
        </Text>
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.address, { color: inArea ? p.text : p.down }]}
          numberOfLines={2}
        >
          {label}
        </Text>
        <Text style={[styles.hint, { color: p.textMuted }]}>Mueve el mapa para ubicar el pin.</Text>
        <Button
          label={isOrigin ? 'Confirmar recogida' : 'Confirmar destino'}
          onPress={confirm}
          disabled={!inArea || moving}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  pin: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  pinIcon: { fontSize: PIN_SIZE, lineHeight: PIN_SIZE + 4 },
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
    gap: spacing.sm,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 20, fontWeight: '700' },
  address: { fontSize: 16, minHeight: 44 },
  hint: { fontSize: 13, marginBottom: spacing.sm },
});
