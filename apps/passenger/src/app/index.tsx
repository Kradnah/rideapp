import { GIRARDOT_CENTER } from '@rideapp/contracts';
import { BaseMap, colors, radius, spacing } from '@rideapp/mobile-core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, ensureDemoSession } from '@/lib/api';
import { config } from '@/lib/config';

const PANEL_HEIGHT = 190;

/** Mapa principal + "¿A dónde vas?" (9.2). En la Fase 0 muestra el mapa y los conductores del mock. */
export default function HomeScreen() {
  const palette = colors[useColorScheme() === 'dark' ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const [panelHeight, setPanelHeight] = useState(PANEL_HEIGHT);

  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api.health.ready(),
    refetchInterval: 15_000,
  });

  const session = useQuery({ queryKey: ['demo-session'], queryFn: ensureDemoSession });

  // Conductores cercanos cada 10 s mientras la pantalla está visible (9.2, paso 3).
  const nearby = useQuery({
    queryKey: ['drivers', 'nearby'],
    queryFn: () => api.drivers.nearby(GIRARDOT_CENTER),
    enabled: session.data === true,
    refetchInterval: 10_000,
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
            {apiUp && session.data
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
