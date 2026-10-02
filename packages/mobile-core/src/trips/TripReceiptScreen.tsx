import type { Trip } from '@rideapp/contracts';
import { radius, spacing, usePalette } from '@rideapp/ui';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { friendlyError } from '../auth/errors';
import { FormScreen } from '../auth/FormScreen';
import { formatDateTime, formatDistance, formatMoney, formatRating } from '../format';
import { useSession } from '../session/SessionProvider';
import { RatingCard } from './RatingCard';

export interface TripReceiptScreenProps {
  tripId: string;
  /** Desde qué lado se mira: cambia los textos y a quién se califica. */
  viewer: 'PASSENGER' | 'DRIVER';
  onBack: () => void;
}

const PAYMENT_STATUS: Record<NonNullable<Trip['payment']>['status'], string> = {
  PENDING: 'Pendiente',
  AUTHORIZED: 'Autorizado',
  CAPTURED: 'Pagado',
  FAILED: 'Falló',
  REFUNDED: 'Reembolsado',
};

/** Detalle de un viaje del historial con su recibo (9.5, paso 3) y, si falta, la calificación. */
export function TripReceiptScreen({ tripId, viewer, onBack }: TripReceiptScreenProps) {
  const p = usePalette();
  const { api } = useSession();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.trips
      .get(tripId)
      .then((t) => active && setTrip(t))
      .catch((err: unknown) => active && setError(friendlyError(err)));
    return () => {
      active = false;
    };
  }, [api, tripId]);

  if (!trip) {
    return (
      <FormScreen title="Recibo" onBack={onBack}>
        {error ? (
          <Text style={{ color: p.down }}>{error}</Text>
        ) : (
          <ActivityIndicator color={p.accent} />
        )}
      </FormScreen>
    );
  }

  const cancelled = trip.status === 'CANCELLED';
  const counterpart = viewer === 'PASSENGER' ? trip.driver : trip.passenger;
  const rows: [string, string][] = [
    ['Fecha', formatDateTime(trip.completedAt ?? trip.cancelledAt ?? trip.requestedAt)],
    ['Desde', trip.originAddress ?? 'Punto en el mapa'],
    ['Hasta', trip.destinationAddress ?? 'Punto en el mapa'],
    ['Distancia', formatDistance(trip.distanceMeters)],
    [viewer === 'PASSENGER' ? 'Conductor' : 'Pasajero', counterpart?.fullName ?? '—'],
  ];
  if (trip.driver) {
    rows.push([
      'Vehículo',
      `${trip.driver.vehicle.brand} ${trip.driver.vehicle.model} · ${trip.driver.vehicle.plate}`,
    ]);
  }
  rows.push(['Pago', trip.paymentMethod === 'CASH' ? 'Efectivo' : 'Tarjeta (demo)']);
  if (trip.payment) rows.push(['Estado del pago', PAYMENT_STATUS[trip.payment.status]]);
  rows.push(['Viaje', trip.id.slice(-8).toUpperCase()]);

  return (
    <FormScreen
      title={cancelled ? 'Viaje cancelado' : 'Recibo'}
      subtitle={cancelled ? 'No se cobró nada por este viaje.' : undefined}
      onBack={onBack}
    >
      <View style={[styles.card, { borderColor: p.border, backgroundColor: p.surface }]}>
        <Text style={[styles.label, { color: p.textMuted }]}>Total</Text>
        <Text
          style={[
            styles.total,
            { color: cancelled ? p.textMuted : p.text },
            cancelled && styles.struck,
          ]}
        >
          {formatMoney(trip.amount)}
        </Text>
        {rows.map(([k, v]) => (
          <View key={k} style={styles.row}>
            <Text style={[styles.key, { color: p.textMuted }]}>{k}</Text>
            <Text style={[styles.value, { color: p.text }]}>{v}</Text>
          </View>
        ))}
      </View>

      {trip.myRating ? (
        <Text style={{ color: p.textMuted }}>
          Calificaste con {'★'.repeat(trip.myRating)}
          {counterpart?.rating ? ` · Su promedio: ${formatRating(counterpart.rating)}` : ''}
        </Text>
      ) : trip.rateableUntil ? (
        <RatingCard
          tripId={trip.id}
          who={viewer === 'PASSENGER' ? 'tu conductor' : 'tu pasajero'}
          onRated={setTrip}
        />
      ) : null}
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm },
  label: { fontSize: 13 },
  total: { fontSize: 32, fontWeight: '800', marginBottom: spacing.sm },
  struck: { textDecorationLine: 'line-through' },
  row: { flexDirection: 'row', gap: spacing.md },
  key: { width: 110, fontSize: 14 },
  value: { flex: 1, fontSize: 14, fontWeight: '500' },
});
