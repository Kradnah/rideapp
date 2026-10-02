import type { LatLng } from './common.js';
import type { VehicleCategory } from './enums.js';
import type { FareRuleAmounts } from './pricing.js';

/**
 * Datos falsos para desarrollo, tests, mock-server y `FakeMapsProvider` (7.4).
 * Se importan desde `@rideapp/contracts/fixtures`, nunca desde el índice principal,
 * para que no acaben por accidente en el código de producción.
 *
 * Las coordenadas son aproximadas: sirven para simular, no para navegar.
 */

export interface FixturePlace {
  placeId: string;
  name: string;
  formattedAddress: string;
  location: LatLng;
}

export const FIXTURE_PLACES: readonly FixturePlace[] = [
  {
    placeId: 'fake-parque-bolivar',
    name: 'Parque Bolívar',
    formattedAddress: 'Parque Bolívar, Girardot, Cundinamarca',
    location: { lat: 4.3036, lng: -74.803 },
  },
  {
    placeId: 'fake-puente-ferreo',
    name: 'Puente Férreo',
    formattedAddress: 'Puente Férreo, Girardot, Cundinamarca',
    location: { lat: 4.3055, lng: -74.807 },
  },
  {
    placeId: 'fake-hospital-san-rafael',
    name: 'Hospital San Rafael',
    formattedAddress: 'Hospital San Rafael, Girardot, Cundinamarca',
    location: { lat: 4.3005, lng: -74.806 },
  },
  {
    placeId: 'fake-unicundi',
    name: 'Universidad de Cundinamarca',
    formattedAddress: 'Universidad de Cundinamarca, Girardot, Cundinamarca',
    location: { lat: 4.298, lng: -74.798 },
  },
  {
    placeId: 'fake-estadio',
    name: 'Estadio Luis Antonio Duque Peña',
    formattedAddress: 'Estadio Luis Antonio Duque Peña, Girardot, Cundinamarca',
    location: { lat: 4.308, lng: -74.796 },
  },
  {
    placeId: 'fake-unicentro',
    name: 'Centro Comercial Unicentro',
    formattedAddress: 'Centro Comercial Unicentro, Girardot, Cundinamarca',
    location: { lat: 4.2955, lng: -74.788 },
  },
  {
    placeId: 'fake-terminal',
    name: 'Terminal de Transportes',
    formattedAddress: 'Terminal de Transportes, Girardot, Cundinamarca',
    location: { lat: 4.306, lng: -74.813 },
  },
  {
    placeId: 'fake-parque-flandes',
    name: 'Parque principal de Flandes',
    formattedAddress: 'Parque principal, Flandes, Tolima',
    location: { lat: 4.2833, lng: -74.8167 },
  },
  {
    placeId: 'fake-parque-ricaurte',
    name: 'Parque principal de Ricaurte',
    formattedAddress: 'Parque principal, Ricaurte, Cundinamarca',
    location: { lat: 4.28, lng: -74.772 },
  },
  {
    placeId: 'fake-penalisa',
    name: 'Peñalisa',
    formattedAddress: 'Peñalisa, Ricaurte, Cundinamarca',
    location: { lat: 4.27, lng: -74.76 },
  },
];

/** Recorrido circular por Girardot para el simulador de conductores (7.3). */
export const DEMO_DRIVER_ROUTE: readonly LatLng[] = [
  { lat: 4.306, lng: -74.813 },
  { lat: 4.3055, lng: -74.807 },
  { lat: 4.3036, lng: -74.803 },
  { lat: 4.3005, lng: -74.806 },
  { lat: 4.298, lng: -74.798 },
  { lat: 4.2955, lng: -74.788 },
  { lat: 4.302, lng: -74.79 },
  { lat: 4.308, lng: -74.796 },
  { lat: 4.3075, lng: -74.805 },
  { lat: 4.306, lng: -74.813 },
];

/** Busca lugares por nombre o dirección, sin tildes ni mayúsculas. */
export function searchFixturePlaces(query: string, limit = 5): FixturePlace[] {
  const norm = (s: string) =>
    s
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
  const q = norm(query.trim());
  return FIXTURE_PLACES.filter(
    (p) => norm(p.name).includes(q) || norm(p.formattedAddress).includes(q),
  ).slice(0, limit);
}

/** Tarifas de demo por categoría, en centavos de COP (las reales viven en `fare_rules`). */
export const DEMO_FARE_RULES = {
  STANDARD: { baseCents: 300_000, perKmCents: 120_000, perMinCents: 20_000, minFareCents: 600_000 },
  MOTO: { baseCents: 200_000, perKmCents: 80_000, perMinCents: 10_000, minFareCents: 400_000 },
} as const satisfies Record<VehicleCategory, FareRuleAmounts>;
