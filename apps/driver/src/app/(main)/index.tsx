import { BaseMap, colors, radius, spacing, useSession } from '@rideapp/mobile-core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View, useColorScheme } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { config } from '@/lib/config';

/**
 * Mapa + interruptor En línea / Fuera de línea (10.2).
 * Fase 0: el interruptor solo cambia el estado local. En la Fase 2 llamará a
 * POST /drivers/me/online y arrancará el envío de ubicación (y lo detendrá por completo al salir).
 */
export default function DriverHomeScreen() {
  const palette = colors[useColorScheme() === 'dark' ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const { api } = useSession();
  const [online, setOnline] = useState(false);
  const [panelHeight, setPanelHeight] = useState(160);

  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api.health.ready(),
    refetchInterval: 15_000,
  });

  const apiUp = health.data?.status === 'ok';

  return (
    <View style={[styles.root, { backgroundColor: palette.bg }]}>
      <BaseMap
        enabled={config.mapsEnabled}
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
          <Switch
            accessibilityLabel="En línea"
            value={online}
            onValueChange={setOnline}
            disabled={!apiUp}
            trackColor={{ true: palette.accent, false: palette.border }}
          />
        </View>
        <View style={styles.row}>
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
  flex: { flex: 1 },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    gap: spacing.lg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { fontSize: 20, fontWeight: '700' },
  subtitle: { fontSize: 14, marginTop: 2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  status: { fontSize: 13 },
});
