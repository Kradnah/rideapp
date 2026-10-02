import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { spacing } from './theme';
import { usePalette } from './usePalette';

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Texto o contenido (puede incluir enlaces). */
  children: ReactNode;
  error?: string | null;
}

/** Casilla nunca premarcada por defecto: el consentimiento debe ser expreso (15.2). */
export function Checkbox({ checked, onChange, children, error }: CheckboxProps) {
  const p = usePalette();
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked }}
          hitSlop={10}
          onPress={() => onChange(!checked)}
          style={[
            styles.box,
            {
              borderColor: error ? p.down : checked ? p.accent : p.border,
              backgroundColor: checked ? p.accent : p.surface,
            },
          ]}
        >
          {checked ? <Text style={[styles.tick, { color: p.onAccent }]}>✓</Text> : null}
        </Pressable>
        <View style={styles.label}>{children}</View>
      </View>
      {error ? <Text style={[styles.error, { color: p.down }]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  box: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  tick: { fontSize: 15, fontWeight: '800', lineHeight: 17 },
  label: { flex: 1 },
  error: { fontSize: 13, marginLeft: 36 },
});
