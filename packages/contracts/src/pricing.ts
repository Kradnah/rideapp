import { z } from 'zod';
import { LatLng, Money } from './common.js';
import { VehicleCategory } from './enums.js';

/** 100 COP expresados en centavos. */
export const FARE_ROUNDING_CENTS = 100 * 100;

/**
 * Única función de redondeo de tarifas (8.7): múltiplos de 100 COP, mitad hacia arriba.
 * Recibe y devuelve centavos enteros.
 */
export function roundFare(amountCents: number): number {
  if (!Number.isFinite(amountCents) || amountCents < 0) {
    throw new RangeError(`Importe inválido: ${amountCents}`);
  }
  return Math.round(amountCents / FARE_ROUNDING_CENTS) * FARE_ROUNDING_CENTS;
}

export interface FareRuleAmounts {
  baseCents: number;
  perKmCents: number;
  perMinCents: number;
  minFareCents: number;
}

/** Tarifa = base + km + minutos, con mínimo, redondeada con `roundFare`. */
export function computeFare(
  rule: FareRuleAmounts,
  distanceMeters: number,
  durationSeconds: number,
): number {
  if (distanceMeters < 0 || durationSeconds < 0) {
    throw new RangeError('La distancia y la duración no pueden ser negativas');
  }
  const raw =
    rule.baseCents +
    (rule.perKmCents * distanceMeters) / 1000 +
    (rule.perMinCents * durationSeconds) / 60;
  return roundFare(Math.max(raw, rule.minFareCents));
}

/** Texto que el pasajero ve como dirección (de Places o de la geocodificación inversa). */
export const AddressLabel = z
  .string()
  .trim()
  .max(200)
  // Sin caracteres de control: el texto se muestra al conductor y en el panel.
  // eslint-disable-next-line no-control-regex
  .transform((v) => v.replace(/[\u0000-\u001f\u007f]/g, ' '));

/**
 * Cotización (8.7). Una sola ruta (una llamada a Routes) sirve para todas las categorías:
 * la respuesta trae una opción por categoría, cada una con su `quoteId`.
 */
export const QuoteRequest = z.strictObject({
  origin: LatLng,
  destination: LatLng,
  destinationPlaceId: z.string().max(300).optional(),
  originAddress: AddressLabel.optional(),
  destinationAddress: AddressLabel.optional(),
});
export type QuoteRequest = z.infer<typeof QuoteRequest>;

export const QuoteOption = z.object({
  quoteId: z.uuid(),
  category: VehicleCategory,
  amount: Money,
});
export type QuoteOption = z.infer<typeof QuoteOption>;

export const QuoteResponse = z.object({
  distanceMeters: z.number().int().nonnegative(),
  durationSeconds: z.number().int().nonnegative(),
  /** Polilínea codificada (formato de Google). */
  polyline: z.string(),
  /** Las cotizaciones caducan a los 5 minutos: después hay que volver a cotizar. */
  expiresAt: z.iso.datetime(),
  options: z.array(QuoteOption).min(1),
});
export type QuoteResponse = z.infer<typeof QuoteResponse>;
