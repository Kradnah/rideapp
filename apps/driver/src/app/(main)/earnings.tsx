import type { DriverEarnings } from '@rideapp/contracts';
import { formatMoney, formatRating, useSession } from '@rideapp/mobile-core';
import { radius, spacing, usePalette } from '@rideapp/ui';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { driverError } from '@/lib/driver-account';

const PERIODS = [
  { key: 'today', label: 'Hoy', days: 1 },
  { key: 'week', label: '7 días', days: 7 },
  { key: 'month', label: '30 días', days: 30 },
] as const;
type Period = (typeof PERIODS)[number]['key'];

/** Día de Colombia (UTC−5, sin horario de verano) `offset` días atrás, como YYYY-MM-DD. */
function colombiaDay(offset = 0): string {
  return new Date(Date.now() - 5 * 3600_000 - offset * 86_400_000).toISOString().slice(0, 10);
}

const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const dayLabel = (date: string) => {
  const d = new Date(`${date}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
};

/** Ganancias del conductor (10.4): suma de los viajes completados. En la demo no hay liquidaciones. */
export default function EarningsScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { api } = useSession();
  const [period, setPeriod] = useState<Period>('today');
  const days = PERIODS.find((x) => x.key === period)!.days;
  const from = colombiaDay(days - 1);
  const to = colombiaDay();

  const earnings = useQuery({
    queryKey: ['earnings', from, to],
    queryFn: () => api.drivers.earnings(from, to),
  });

  return (
    <ScrollView
      style={{ backgroundColor: p.bg }}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl },
      ]}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Volver"
          hitSlop={12}
          onPress={() => router.back()}
        >
          <Text style={[styles.back, { color: p.text }]}>←</Text>
        </Pressable>
        <Text accessibilityRole="header" style={[styles.title, { color: p.text }]}>
          Ganancias
        </Text>
      </View>

      <View style={[styles.tabs, { borderColor: p.border }]} accessibilityRole="tablist">
        {PERIODS.map((x) => {
          const selected = x.key === period;
          return (
            <Pressable
              key={x.key}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => setPeriod(x.key)}
              style={[styles.tab, selected && { backgroundColor: p.accent }]}
            >
              <Text style={[styles.tabText, { color: selected ? p.onAccent : p.text }]}>
                {x.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {earnings.isPending ? (
        <ActivityIndicator color={p.accent} />
      ) : earnings.isError ? (
        <Text style={{ color: p.down }}>{driverError(earnings.error)}</Text>
      ) : (
        <Summary data={earnings.data} multiDay={days > 1} />
      )}

      <Text style={[styles.note, { color: p.textMuted }]}>
        Suma de tus viajes completados. En esta demo no hay liquidaciones: el efectivo lo recibes tú
        y los pagos con tarjeta demo no son cobros reales.
      </Text>
    </ScrollView>
  );
}

function Summary({ data, multiDay }: { data: DriverEarnings; multiDay: boolean }) {
  const p = usePalette();
  return (
    <>
      <View style={[styles.card, { backgroundColor: p.surface, borderColor: p.border }]}>
        <Text style={[styles.total, { color: p.text }]}>{formatMoney(data.total)}</Text>
        <Text style={[styles.muted, { color: p.textMuted }]}>
          {data.trips} viaje{data.trips === 1 ? '' : 's'} completado{data.trips === 1 ? '' : 's'}
        </Text>
        <View style={[styles.split, { borderColor: p.border }]}>
          <View style={styles.flex}>
            <Text style={[styles.muted, { color: p.textMuted }]}>Efectivo</Text>
            <Text style={[styles.amount, { color: p.text }]}>{formatMoney(data.cash)}</Text>
          </View>
          <View style={styles.flex}>
            <Text style={[styles.muted, { color: p.textMuted }]}>Tarjeta (demo)</Text>
            <Text style={[styles.amount, { color: p.text }]}>{formatMoney(data.card)}</Text>
          </View>
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: p.surface, borderColor: p.border }]}>
        <Text style={[styles.muted, { color: p.textMuted }]}>Tu calificación</Text>
        <Text style={[styles.amount, { color: p.text }]}>
          {data.rating.average === null
            ? 'Todavía sin calificaciones'
            : `★ ${formatRating(data.rating.average)} · ${data.rating.count} calificación${data.rating.count === 1 ? '' : 'es'}`}
        </Text>
      </View>

      {multiDay && data.days.length > 0 && (
        <View style={[styles.card, { backgroundColor: p.surface, borderColor: p.border }]}>
          {[...data.days].reverse().map((d) => (
            <View key={d.date} style={styles.dayRow}>
              <Text style={[styles.dayLabel, { color: p.text }]}>{dayLabel(d.date)}</Text>
              <Text style={[styles.muted, { color: p.textMuted }]}>
                {d.trips} viaje{d.trips === 1 ? '' : 's'}
              </Text>
              <Text style={[styles.dayAmount, { color: p.text }]}>
                {formatMoney({ amountCents: d.amountCents, currency: data.total.currency })}
              </Text>
            </View>
          ))}
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  back: { fontSize: 28 },
  title: { fontSize: 26, fontWeight: '700' },
  tabs: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: radius.pill,
    padding: 3,
  },
  tab: {
    flex: 1,
    minHeight: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabText: { fontSize: 15, fontWeight: '600' },
  card: { borderWidth: 1, borderRadius: radius.md, padding: spacing.lg, gap: spacing.xs },
  total: { fontSize: 34, fontWeight: '800' },
  muted: { fontSize: 13 },
  split: {
    flexDirection: 'row',
    gap: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
  },
  flex: { flex: 1 },
  amount: { fontSize: 17, fontWeight: '700' },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 4 },
  dayLabel: { width: 90, fontSize: 15, fontWeight: '600' },
  dayAmount: { marginLeft: 'auto', fontSize: 15, fontWeight: '700' },
  note: { fontSize: 13, lineHeight: 19 },
});
