import { radius, spacing, usePalette } from '@rideapp/ui';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PRIVACY_POLICY } from './privacy-policy';

/** Política de Tratamiento de la Información, accesible antes del registro (15.2). */
export function PrivacyPolicyScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ backgroundColor: p.bg }}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
    >
      {PRIVACY_POLICY.draft ? (
        <View style={[styles.banner, { borderColor: p.pending }]}>
          <Text style={{ color: p.text, fontSize: 13, lineHeight: 18 }}>
            Borrador para la demo. El texto definitivo debe revisarlo un abogado antes de operar con
            usuarios reales.
          </Text>
        </View>
      ) : null}
      <Text accessibilityRole="header" style={[styles.title, { color: p.text }]}>
        Política de Tratamiento de la Información
      </Text>
      <Text style={{ color: p.textMuted }}>Versión {PRIVACY_POLICY.version}</Text>
      {PRIVACY_POLICY.sections.map((s) => (
        <View key={s.title} style={styles.section}>
          <Text accessibilityRole="header" style={[styles.heading, { color: p.text }]}>
            {s.title}
          </Text>
          <Text style={[styles.body, { color: p.text }]}>{s.body}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, gap: spacing.lg },
  banner: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  title: { fontSize: 24, fontWeight: '700' },
  section: { gap: spacing.xs },
  heading: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22 },
});
