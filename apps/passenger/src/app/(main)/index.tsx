import { GIRARDOT_CENTER } from '@rideapp/contracts';
import { BaseMap, colors, radius, spacing, useSession } from '@rideapp/mobile-core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { Marker } from 'react-native-maps';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { config } from '@/lib/config';
import { usePassengerLocation } from '@/lib/use-passenger-location';

const PANEL_HEIGHT = 190;

/** Mapa principal + "¿A dónde vas?" (9.2), con los conductores libres cerca (aproximados, sin ID). */
export default function HomeScreen() {
  const palette = colors[useColorScheme() === 'dark' ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const { api } = useSession();
  const [panelHeight, setPanelHeight] = useState(PANEL_HEIGHT);
  const location = usePassengerLocation();
  const origin = location.position && location.inServiceArea ? location.position : GIRARDOT_CENTER;

  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api.health.ready(),
    refetchInterval: 15_000,
  });

  // Conductores cercanos cada 10 s mientras la pantalla está visible (9.2, paso 3).
  // La clave usa la posición redondeada (~100 m): moverse unos metros no dispara otra consulta.
  const nearby = useQuery({
    queryKey: ['drivers', 'nearby', origin.lat.toFixed(3), origin.lng.toFixed(3)],
    queryFn: () => api.drivers.nearby(origin),
    retry: false,
    placeholderData: (previous) => previous,
    refetchInterval: (query) => (query.state.status === 'error' ? false : 10_000),
  });

  const apiUp = health.data?.status === 'ok';
  const drivers = nearby.data?.drivers ?? [];

  return (
    <View style={[styles.root, { backgroundColor: palette.bg }]}>
      <BaseMap
        enabled={config.mapsEnabled}
        mapPadding={{ top: insets.top, right: 0, bottom: panelHeight, left: 0 }}
        showsUserLocation={location.permission === 'granted'}
        center={location.position}
      >
        {drivers.map((d, i) => (
          <Marker
            // Las posiciones llegan sin ID (8.5): el índice basta para pintarlas.
            key={i}
            coordinate={{ latitude: d.position.lat, longitude: d.position.lng }}
            rotation={d.heading ?? 0}
            flat
            anchor={{ x: 0.5, y: 0.5 }}
            title="Conductor disponible"
          />
        ))}
      </BaseMap>

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

      {location.permission === 'granted' && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Centrar en mi ubicación"
          onPress={() => void location.locate()}
          style={[
            styles.profileButton,
            styles.locateButton,
            {
              top: insets.top + spacing.md,
              backgroundColor: palette.surface,
              borderColor: palette.border,
            },
          ]}
        >
          <Text style={[styles.profileIcon, { color: palette.accent }]}>◎</Text>
        </Pressable>
      )}

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
        <Text style={[styles.title, { color: palette.text }]}>Hola 👋</Text>
        {location.permission === 'undetermined' && (
          <Pressable
            accessibilityRole="button"
            onPress={() => void location.request()}
            style={[styles.locationCard, { borderColor: palette.accent }]}
          >
            <Text style={[styles.locationTitle, { color: palette.text }]}>Usar mi ubicación</Text>
            <Text style={[styles.status, { color: palette.textMuted }]}>
              Para mostrarte los conductores cerca de ti y recogerte donde estás. Solo mientras usas
              la app.
            </Text>
          </Pressable>
        )}
        {location.permission === 'denied' && (
          <Text style={[styles.status, { color: palette.textMuted }]}>
            Sin acceso a tu ubicación: te mostramos el centro de Girardot. Puedes activarla en los
            ajustes.
          </Text>
        )}
        {location.inServiceArea === false && (
          <Text style={[styles.status, { color: palette.pending }]}>
            Estás fuera de la zona de servicio (Girardot, Ricaurte y Flandes).
          </Text>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: true }}
          accessibilityHint="Disponible en la Fase 3"
          style={[styles.search, { borderColor: palette.border, backgroundColor: palette.bg }]}
        >
          <Text style={[styles.searchText, { color: palette.textMuted }]}>¿A dónde vas?</Text>
        </Pressable>
        <View style={styles.statusRow}>
          <View
            style={[
              styles.dot,
              {
                backgroundColor: health.isPending
                  ? palette.pending
                  : apiUp
                    ? palette.ok
                    : palette.down,
              },
            ]}
          />
          <Text style={[styles.status, { color: palette.textMuted }]}>
            {health.isPending ? 'Conectando…' : apiUp ? 'Conectado al servidor' : 'Sin conexión'}
            {apiUp && nearby.isSuccess
              ? ` · ${drivers.length} conductor${drivers.length === 1 ? '' : 'es'} cerca`
              : ''}
          </Text>
        </View>
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
  locateButton: { left: undefined, right: spacing.lg },
  locationCard: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  locationTitle: { fontSize: 15, fontWeight: '600' },
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
  title: { fontSize: 22, fontWeight: '700' },
  search: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
  },
  searchText: { fontSize: 16 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  status: { fontSize: 13 },
});
