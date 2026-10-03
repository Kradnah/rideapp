import { spacing, usePalette } from '@rideapp/ui';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface UpgradeRequiredScreenProps {
  currentVersion: string;
  minVersion: string | null;
}

/**
 * El API respondió 426 (14.5): esta versión ya no es compatible. Bloquea la app en lugar de
 * fallar pantalla por pantalla. En la demo las APK se reparten a mano (13.5 G).
 */
export function UpgradeRequiredScreen({ currentVersion, minVersion }: UpgradeRequiredScreenProps) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        gap: spacing.md,
        padding: spacing.xl,
        paddingTop: insets.top + spacing.xl,
        backgroundColor: p.bg,
      }}
    >
      <Text accessibilityRole="header" style={{ color: p.text, fontSize: 24, fontWeight: '700' }}>
        Actualiza la app
      </Text>
      <Text style={{ color: p.text, fontSize: 16, lineHeight: 24 }}>
        Esta versión ya no funciona con el servicio. Instala la versión más reciente para seguir.
      </Text>
      <Text style={{ color: p.textMuted, fontSize: 14 }}>
        Tienes la {currentVersion}
        {minVersion ? `; la mínima es la ${minVersion}` : ''}.
      </Text>
    </View>
  );
}
