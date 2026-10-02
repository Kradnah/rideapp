import type { Money } from '@rideapp/contracts';

/** Separador de miles a mano: no todos los motores de React Native traen Intl completo. */
const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** Importes en centavos (8.7) → "$ 12.300". */
export function formatMoney({ amountCents, currency }: Money): string {
  const units = Math.round(amountCents / 100);
  return currency === 'COP' ? `$ ${thousands(units)}` : `${thousands(units)} ${currency}`;
}

export function formatDistance(meters: number): string {
  return meters < 1000 ? `${meters} m` : `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
}

export function formatDuration(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "2 oct, 2:35 p. m." en la hora del teléfono (sin depender de Intl). */
export function formatDateTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const hours = d.getHours();
  const time = `${hours % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${hours < 12 ? 'a. m.' : 'p. m.'}`;
  const year = d.getFullYear() === now.getFullYear() ? '' : ` ${d.getFullYear()}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${year}, ${time}`;
}

/** Promedio de calificaciones: "4,8". */
export function formatRating(average: number): string {
  return average.toFixed(1).replace('.', ',');
}
