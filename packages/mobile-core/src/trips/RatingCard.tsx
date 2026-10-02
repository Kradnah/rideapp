import { ApiClientError } from '@rideapp/api-client';
import { RATING_COMMENT_MAX, type Trip } from '@rideapp/contracts';
import { Button, radius, spacing, TextField, usePalette } from '@rideapp/ui';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { friendlyError } from '../auth/errors';
import { useSession } from '../session/SessionProvider';

const LABELS = ['', 'Muy malo', 'Malo', 'Regular', 'Bueno', 'Excelente'];

export interface RatingCardProps {
  tripId: string;
  /** "tu conductor", "tu pasajero"… */
  who: string;
  onRated: (trip: Trip) => void;
}

/** Calificar a la otra parte (9.5, paso 2; 10.3, paso 5): de 1 a 5 estrellas y comentario opcional. */
export function RatingCard({ tripId, who, onRated }: RatingCardProps) {
  const p = usePalette();
  const { api } = useSession();
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const trimmed = comment.trim();
      onRated(await api.trips.rate(tripId, { score, ...(trimmed && { comment: trimmed }) }));
    } catch (err) {
      // "Ya calificaste" o "pasó el plazo": el mensaje del API ya está pensado para el usuario.
      setError(
        err instanceof ApiClientError && err.code === 'CONFLICT' ? err.message : friendlyError(err),
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={[styles.card, { borderColor: p.border }]}>
      <Text style={[styles.title, { color: p.text }]}>¿Cómo te fue con {who}?</Text>
      <View style={styles.stars} accessibilityRole="radiogroup">
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            accessibilityRole="radio"
            accessibilityLabel={`${n} estrella${n === 1 ? '' : 's'}: ${LABELS[n]}`}
            accessibilityState={{ checked: score === n }}
            hitSlop={6}
            onPress={() => setScore(n)}
          >
            <Text style={[styles.star, { color: n <= score ? p.pending : p.border }]}>★</Text>
          </Pressable>
        ))}
      </View>
      <Text style={[styles.hint, { color: p.textMuted }]}>
        {score ? LABELS[score] : 'Toca una estrella'}
      </Text>
      {score > 0 && (
        <TextField
          label="Comentario (opcional)"
          value={comment}
          onChangeText={setComment}
          maxLength={RATING_COMMENT_MAX}
          multiline
          style={styles.comment}
        />
      )}
      {error && (
        <Text accessibilityLiveRegion="polite" style={{ color: p.down }}>
          {error}
        </Text>
      )}
      <Button label="Enviar calificación" onPress={send} disabled={!score} loading={sending} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  title: { fontSize: 16, fontWeight: '700' },
  stars: { flexDirection: 'row', gap: spacing.sm },
  star: { fontSize: 36 },
  hint: { fontSize: 13 },
  comment: { minHeight: 70, paddingTop: spacing.sm, textAlignVertical: 'top' },
});
