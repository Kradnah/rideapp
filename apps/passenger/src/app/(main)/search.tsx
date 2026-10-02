import type { AutocompleteSuggestion } from '@rideapp/contracts';
import { randomId, useSession } from '@rideapp/mobile-core';
import { radius, spacing, usePalette } from '@rideapp/ui';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTripDraft } from '@/lib/trip-draft';
import { tripError } from '@/lib/trip-errors';

const DEBOUNCE_MS = 400;
const MIN_CHARS = 3;

/** Texto tecleado, pero solo después de 400 ms sin escribir (9.3, paso 1). */
function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/**
 * Buscar destino (9.3). Un `sessionToken` por búsqueda, reutilizado en cada tecla y en el detalle
 * del lugar elegido: Google lo cobra como una sola sesión.
 */
export default function SearchScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { api } = useSession();
  const draft = useTripDraft();
  const [sessionToken] = useState(randomId);
  const [text, setText] = useState('');
  const [choosing, setChoosing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = useDebounced(text.trim(), DEBOUNCE_MS);

  const suggestions = useQuery({
    queryKey: ['geo', 'autocomplete', sessionToken, q],
    queryFn: ({ signal }) => api.geo.autocomplete(q, sessionToken, signal),
    enabled: q.length >= MIN_CHARS,
    retry: false,
    staleTime: 60_000,
  });

  const choose = async (s: AutocompleteSuggestion) => {
    setChoosing(s.placeId);
    setError(null);
    try {
      const place = await api.geo.place(s.placeId, sessionToken);
      draft.setDestination({
        location: place.location,
        // Nombre y zona, como en la sugerencia: más reconocible que la dirección postal.
        address: (s.secondaryText?.startsWith(s.primaryText)
          ? s.secondaryText
          : [s.primaryText, s.secondaryText].filter(Boolean).join(', ')
        ).slice(0, 200),
        placeId: place.placeId,
      });
      router.push(draft.origin ? '/confirm' : { pathname: '/pick', params: { target: 'origin' } });
    } catch (err) {
      setError(tripError(err));
    } finally {
      setChoosing(null);
    }
  };

  const results = suggestions.data?.suggestions ?? [];

  return (
    <View style={[styles.root, { backgroundColor: p.bg, paddingTop: insets.top + spacing.md }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Volver"
          onPress={() => router.back()}
          style={styles.back}
        >
          <Text style={[styles.backIcon, { color: p.text }]}>←</Text>
        </Pressable>
        <Text style={[styles.title, { color: p.text }]}>¿A dónde vas?</Text>
      </View>

      <View style={[styles.fields, { borderColor: p.border, backgroundColor: p.surface }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Punto de recogida"
          accessibilityHint="Elegir en el mapa"
          onPress={() => router.push({ pathname: '/pick', params: { target: 'origin' } })}
          style={styles.row}
        >
          <View style={[styles.dot, { backgroundColor: p.accent }]} />
          <Text style={[styles.rowText, { color: draft.origin ? p.text : p.textMuted }]}>
            {draft.origin
              ? (draft.origin.address ?? 'Mi ubicación actual')
              : 'Elige dónde te recogemos'}
          </Text>
        </Pressable>
        <View style={[styles.separator, { backgroundColor: p.border }]} />
        <View style={styles.row}>
          <View style={[styles.square, { borderColor: p.text }]} />
          <TextInput
            autoFocus
            value={text}
            onChangeText={setText}
            placeholder="Busca un lugar o dirección"
            placeholderTextColor={p.textMuted}
            accessibilityLabel="Destino"
            returnKeyType="search"
            autoCorrect={false}
            style={[styles.input, { color: p.text }]}
          />
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => router.push({ pathname: '/pick', params: { target: 'destination' } })}
        style={[styles.mapOption, { borderColor: p.border }]}
      >
        <Text style={[styles.mapIcon, { color: p.accent }]}>⌖</Text>
        <Text style={[styles.rowText, { color: p.text }]}>Elegir el destino en el mapa</Text>
      </Pressable>

      {(error || suggestions.isError) && (
        <Text accessibilityLiveRegion="polite" style={[styles.error, { color: p.down }]}>
          {error ?? tripError(suggestions.error)}
        </Text>
      )}
      {suggestions.isFetching && <ActivityIndicator color={p.accent} style={styles.loading} />}
      {q.length >= MIN_CHARS && suggestions.isSuccess && results.length === 0 && (
        <Text style={[styles.empty, { color: p.textMuted }]}>
          Sin resultados en Girardot, Ricaurte o Flandes. Prueba con otro nombre o elige en el mapa.
        </Text>
      )}

      <FlatList
        data={results}
        keyExtractor={(s) => s.placeId}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.lg }}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            disabled={choosing !== null}
            onPress={() => void choose(item)}
            style={({ pressed }) => [
              styles.suggestion,
              { borderColor: p.border, opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <View style={styles.flex}>
              <Text style={[styles.primary, { color: p.text }]}>{item.primaryText}</Text>
              {item.secondaryText && (
                <Text style={[styles.secondary, { color: p.textMuted }]} numberOfLines={1}>
                  {item.secondaryText}
                </Text>
              )}
            </View>
            {choosing === item.placeId && <ActivityIndicator color={p.accent} />}
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: spacing.lg, gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 24 },
  title: { fontSize: 22, fontWeight: '700' },
  fields: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 52 },
  rowText: { fontSize: 16, flexShrink: 1 },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 22 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  square: { width: 10, height: 10, borderWidth: 2 },
  input: { flex: 1, fontSize: 16, minHeight: 52 },
  mapOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  mapIcon: { fontSize: 20, width: 10, textAlign: 'center' },
  error: { fontSize: 14 },
  loading: { marginTop: spacing.sm },
  empty: { fontSize: 14, lineHeight: 20 },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  flex: { flex: 1 },
  primary: { fontSize: 16, fontWeight: '600' },
  secondary: { fontSize: 13, marginTop: 2 },
});
