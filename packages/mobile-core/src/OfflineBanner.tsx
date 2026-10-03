import { useNetInfo } from '@react-native-community/netinfo';
import { spacing, usePalette } from '@rideapp/ui';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Aviso fijo arriba cuando el teléfono no tiene internet (Fase 6: "sin red"). No bloquea: el
 * mapa y el último estado conocido siguen visibles, y las consultas se reanudan solas al volver.
 */
export function OfflineBanner() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const net = useNetInfo();
  // null = todavía no se sabe: no se muestra nada para no parpadear al abrir.
  const offline = net.isConnected === false || net.isInternetReachable === false;
  if (!offline) return null;
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        paddingTop: insets.top + spacing.xs,
        paddingBottom: spacing.xs,
        paddingHorizontal: spacing.md,
        backgroundColor: p.down,
      }}
    >
      <Text style={{ color: p.bg, fontSize: 14, fontWeight: '600', textAlign: 'center' }}>
        Sin conexión. Reintentaremos cuando vuelva internet.
      </Text>
    </View>
  );
}
