import { spacing, usePalette } from '@rideapp/ui';
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface FormScreenProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Muestra el botón de volver. Las pantallas no usan el encabezado nativo: con el modo
   *  edge-to-edge de Android se dibujaba encima del contenido. */
  onBack?: () => void;
}

/** Contenedor común de formularios: respeta el teclado y las zonas seguras. */
export function FormScreen({ title, subtitle, children, footer, onBack }: FormScreenProps) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: p.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {onBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Volver"
            hitSlop={12}
            onPress={onBack}
            style={styles.back}
          >
            <Text style={[styles.backIcon, { color: p.text }]}>←</Text>
          </Pressable>
        ) : null}
        <View style={styles.header}>
          <Text accessibilityRole="header" style={[styles.title, { color: p.text }]}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: p.textMuted }]}>{subtitle}</Text>
          ) : null}
        </View>
        <View style={styles.body}>{children}</View>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function FormError({ message }: { message: string | null }) {
  const p = usePalette();
  if (!message) return null;
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      style={[styles.error, { borderColor: p.down }]}
    >
      <Text style={{ color: p.down, fontSize: 14 }}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: spacing.xl, gap: spacing.xl },
  back: { alignSelf: 'flex-start', paddingVertical: spacing.xs, marginLeft: -spacing.xs },
  backIcon: { fontSize: 28 },
  header: { gap: spacing.sm },
  title: { fontSize: 28, fontWeight: '700' },
  subtitle: { fontSize: 15, lineHeight: 21 },
  body: { gap: spacing.lg },
  footer: { marginTop: 'auto', gap: spacing.md },
  error: { borderWidth: 1, borderRadius: 10, padding: spacing.md },
});
