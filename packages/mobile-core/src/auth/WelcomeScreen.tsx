import { Button, spacing, usePalette } from '@rideapp/ui';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface WelcomeScreenProps {
  appName: string;
  tagline: string;
  onLogin: () => void;
  onRegister: () => void;
  /** Botón "Continuar con Google" (paso 1c), si la app lo tiene configurado. */
  extraButtons?: ReactNode;
  error?: string | null;
}

/** Bienvenida (9.1, paso 2): Google (cuando esté), email o crear cuenta. */
export function WelcomeScreen({
  appName,
  tagline,
  onLogin,
  onRegister,
  extraButtons,
  error,
}: WelcomeScreenProps) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: p.bg,
          paddingTop: insets.top + 64,
          paddingBottom: insets.bottom + spacing.xl,
        },
      ]}
    >
      <View style={styles.hero}>
        <Text accessibilityRole="header" style={[styles.brand, { color: p.accent }]}>
          {appName}
        </Text>
        <Text style={[styles.tagline, { color: p.text }]}>{tagline}</Text>
        <Text style={[styles.zone, { color: p.textMuted }]}>Girardot · Ricaurte · Flandes</Text>
      </View>
      <View style={styles.actions}>
        {error ? (
          <Text
            accessibilityRole="alert"
            style={{ color: p.down, fontSize: 14, textAlign: 'center' }}
          >
            {error}
          </Text>
        ) : null}
        {extraButtons}
        <Button label="Iniciar sesión con email" onPress={onLogin} variant="secondary" />
        <Button label="Crear cuenta" onPress={onRegister} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: spacing.xl, justifyContent: 'space-between' },
  hero: { gap: spacing.md },
  brand: { fontSize: 40, fontWeight: '800', letterSpacing: -1 },
  tagline: { fontSize: 22, fontWeight: '600', lineHeight: 28 },
  zone: { fontSize: 15 },
  actions: { gap: spacing.md },
});
