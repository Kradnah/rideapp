import { GIRARDOT_CENTER } from '@rideapp/contracts';
import { BaseMap, colors, radius, spacing, useSession } from '@rideapp/mobile-core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { Marker } from 'react-native-maps';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { config } from '@/lib/config';

const PANEL_HEIGHT = 190;

/** Mapa principal + "¿A dónde vas?" (9.2). Los conductores cercanos llegan del mock hasta la Fase 2. */
export default function HomeScreen() {
  const palette = colors[useColorScheme() === 'dark' ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const { api } = useSession();
  const [panelHeight, setPanelHeight] = useState(PANEL_HEIGHT);

  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api.health.ready(),
    refetchInterval: 15_000,
  });

  // Conductores cercanos cada 10 s mientras la pantalla está visible (9.2, paso 3).
  const nearby = useQuery({
    queryKey: ['drivers', 'nearby'],
    queryFn: () => api.drivers.nearby(GIRARDOT_CENTER),
    retry: false,
    // Si el API aún no tiene este endpoint (producción antes de la Fase 2), deja de insistir.
    refetchInterval: (query) => (query.state.status === 'error' ? false : 10_000),
  });

  const apiUp = health.data?.status === 'ok';
  const drivers = nearby.data?.drivers ?? [];

  return (
    <View style={[styles.root, { backgroundColor: palette.bg }]}>
      <BaseMap
        enabled={config.mapsEnabled}
        mapPadding={{ top: insets.top, right: 0, bottom: panelHeight, left: 0 }}
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
    right: spacing.lg,
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
  },
  profileIcon: { fontSize: 20, fontWeight: '600' },
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
