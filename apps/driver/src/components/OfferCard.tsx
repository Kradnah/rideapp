import type { DriverOffer } from '@rideapp/contracts';
import { formatDistance, formatMoney } from '@rideapp/mobile-core';
import { Button, radius, spacing, usePalette } from '@rideapp/ui';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, Vibration, View } from 'react-native';

const PAYMENT = { CASH: 'Efectivo', FAKE_CARD: 'Tarjeta (demo)' } as const;

function useSecondsLeft(expiresAt: string): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000));
}

/**
 * Oferta de viaje (10.3, paso 1): distancia a la recogida, zonas aproximadas (sin direcciones
 * exactas hasta aceptar, 14.4), precio y cuenta regresiva de 15 s. Vibra al aparecer.
 */
export function OfferCard({
  offer,
  busy,
  onAccept,
  onReject,
}: {
  offer: DriverOffer;
  busy: 'accept' | 'reject' | null;
  onAccept: () => void;
  onReject: () => void;
}) {
  const p = usePalette();
  const left = useSecondsLeft(offer.expiresAt);

  useEffect(() => {
    Vibration.vibrate([0, 400, 200, 400]);
    return () => Vibration.cancel();
  }, [offer.tripId]);

  return (
    <View
      accessibilityLiveRegion="assertive"
      style={[styles.card, { backgroundColor: p.surface, borderColor: p.accent }]}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: p.text }]}>Nueva solicitud</Text>
        <Text
          accessibilityLabel={`Quedan ${left} segundos`}
          style={[styles.timer, { color: left <= 5 ? p.down : p.accent, borderColor: p.border }]}
        >
          {left}s
        </Text>
      </View>
      <Text style={[styles.price, { color: p.text }]}>{formatMoney(offer.amount)}</Text>
      <Text style={[styles.detail, { color: p.textMuted }]}>
        {PAYMENT[offer.paymentMethod]} · recogida a {formatDistance(offer.pickupDistanceMeters)}
      </Text>
      <Text style={[styles.detail, { color: p.text }]}>
        {offer.pickupArea} → {offer.destinationArea}
      </Text>
      <View style={styles.actions}>
        <View style={styles.flex}>
          <Button
            label="Rechazar"
            variant="secondary"
            onPress={onReject}
            loading={busy === 'reject'}
            disabled={busy !== null || left === 0}
          />
        </View>
        <View style={styles.flex}>
          <Button
            label="Aceptar"
            onPress={onAccept}
            loading={busy === 'accept'}
            disabled={busy !== null || left === 0}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 2,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.xs,
    elevation: 6,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: '700' },
  timer: {
    fontSize: 16,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: 2,
  },
  price: { fontSize: 30, fontWeight: '800' },
  detail: { fontSize: 15 },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  flex: { flex: 1 },
});
