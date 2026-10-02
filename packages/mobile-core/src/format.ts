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
