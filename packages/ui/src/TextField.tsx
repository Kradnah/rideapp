import { forwardRef, useState } from 'react';
import { StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';
import { radius, spacing } from './theme';
import { usePalette } from './usePalette';

export interface TextFieldProps extends TextInputProps {
  label: string;
  error?: string | null;
  hint?: string;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, error, hint, style, onFocus, onBlur, ...rest },
  ref,
) {
  const p = usePalette();
  const [focused, setFocused] = useState(false);
  const borderColor = error ? p.down : focused ? p.accent : p.border;

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: p.text }]}>{label}</Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        accessibilityHint={error ?? hint}
        placeholderTextColor={p.textMuted}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[styles.input, { color: p.text, backgroundColor: p.surface, borderColor }, style]}
        {...rest}
      />
      {error ? (
        <Text accessibilityLiveRegion="polite" style={[styles.help, { color: p.down }]}>
          {error}
        </Text>
      ) : hint ? (
        <Text style={[styles.help, { color: p.textMuted }]}>{hint}</Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  label: { fontSize: 14, fontWeight: '600' },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    fontSize: 16,
  },
  help: { fontSize: 13 },
});
