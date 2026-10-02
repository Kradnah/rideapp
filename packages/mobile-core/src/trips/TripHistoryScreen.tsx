import type { TripHistoryItem } from '@rideapp/contracts';
import { Button, radius, spacing, usePalette } from '@rideapp/ui';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { friendlyError } from '../auth/errors';
import { formatDateTime, formatMoney } from '../format';
import { useSession } from '../session/SessionProvider';

export interface TripHistoryScreenProps {
  onBack: () => void;
  onOpen: (tripId: string) => void;
  /** "Conductor" para el pasajero, "Pasajero" para el conductor. */
  counterpartLabel: string;
}

const PAGE = 20;

/** Historial de viajes terminados (9.5, paso 3), paginado con cursor. */
export function TripHistoryScreen({ onBack, onOpen, counterpartLabel }: TripHistoryScreenProps) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { api } = useSession();
  const [items, setItems] = useState<TripHistoryItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'idle' | 'more' | 'refreshing'>('loading');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (from: string | null) => {
      try {
        const page = await api.trips.history({ limit: PAGE, ...(from && { cursor: from }) });
        setItems((prev) => (from ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setError(null);
      } catch (err) {
        setError(friendlyError(err));
      } finally {
        setState('idle');
      }
    },
    [api],
  );

  // Primera página al abrir (la lógica está en `load`; aquí solo se dispara).
  useEffect(() => {
    const first = setTimeout(() => void load(null), 0);
    return () => clearTimeout(first);
  }, [load]);

  const refresh = () => {
    setState('refreshing');
    void load(null);
  };
  const more = () => {
    if (!cursor || state !== 'idle') return;
    setState('more');
    void load(cursor);
  };

  return (
    <View style={[styles.root, { backgroundColor: p.bg, paddingTop: insets.top + spacing.md }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Volver"
          hitSlop={12}
          onPress={onBack}
        >
          <Text style={[styles.back, { color: p.text }]}>←</Text>
        </Pressable>
        <Text accessibilityRole="header" style={[styles.title, { color: p.text }]}>
          Mis viajes
        </Text>
      </View>

      {state === 'loading' ? (
        <ActivityIndicator color={p.accent} style={styles.loading} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(t) => t.id}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.xl }]}
          refreshControl={
            <RefreshControl refreshing={state === 'refreshing'} onRefresh={refresh} />
          }
          onEndReached={more}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            <Text style={[styles.muted, { color: p.textMuted }]}>
              {error ?? 'Todavía no tienes viajes terminados.'}
            </Text>
          }
          ListFooterComponent={
            state === 'more' ? (
              <ActivityIndicator color={p.accent} />
            ) : error && items.length ? (
              <Button label="Reintentar" variant="secondary" onPress={() => void load(cursor)} />
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityHint="Abre el detalle y el recibo"
              onPress={() => onOpen(item.id)}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: p.surface, borderColor: p.border, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <View style={styles.rowTop}>
                <Text style={[styles.date, { color: p.textMuted }]}>
                  {formatDateTime(item.completedAt ?? item.requestedAt)}
                </Text>
                <Text
                  style={[
                    styles.amount,
                    {
                      color: item.status === 'CANCELLED' ? p.textMuted : p.text,
                      textDecorationLine: item.status === 'CANCELLED' ? 'line-through' : 'none',
                    },
                  ]}
                >
                  {formatMoney(item.amount)}
                </Text>
              </View>
              <Text style={[styles.place, { color: p.text }]} numberOfLines={1}>
                {item.destinationAddress ?? 'Destino en el mapa'}
              </Text>
              <Text style={[styles.muted, { color: p.textMuted }]} numberOfLines={1}>
                {item.status === 'CANCELLED'
                  ? 'Cancelado'
                  : `${counterpartLabel}: ${item.counterpartName ?? '—'}`}
                {item.myRating ? ` · Calificaste ${'★'.repeat(item.myRating)}` : ''}
              </Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  back: { fontSize: 28 },
  title: { fontSize: 26, fontWeight: '700' },
  loading: { marginTop: spacing.xl },
  list: { paddingHorizontal: spacing.xl, gap: spacing.md },
  row: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between' },
  date: { fontSize: 13 },
  amount: { fontSize: 16, fontWeight: '700' },
  place: { fontSize: 15, fontWeight: '600' },
  muted: { fontSize: 13, lineHeight: 19 },
});
