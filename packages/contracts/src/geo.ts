import { z } from 'zod';
import { LatLng } from './common.js';

/** Centro de Girardot, usado como vista inicial de los mapas. */
export const GIRARDOT_CENTER: LatLng = { lat: 4.3035, lng: -74.8036 };

/**
 * Rectángulo aproximado de la zona de servicio (Girardot, Ricaurte y Flandes), 7.4.
 * Sirve para filtros rápidos en clientes y para `locationRestriction` de Places.
 * La validación autoritativa la hace el backend con el polígono en PostGIS.
 */
export const SERVICE_AREA_BOUNDS = {
  south: 4.22,
  west: -74.88,
  north: 4.36,
  east: -74.7,
} as const;

export function isInServiceAreaBounds({ lat, lng }: LatLng): boolean {
  const b = SERVICE_AREA_BOUNDS;
  return lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east;
}

export const AutocompleteQuery = z.object({
  q: z.string().trim().min(3).max(120),
  sessionToken: z.uuid(),
});
export type AutocompleteQuery = z.infer<typeof AutocompleteQuery>;

export const AutocompleteSuggestion = z.object({
  placeId: z.string(),
  primaryText: z.string(),
  secondaryText: z.string().nullable(),
});
export type AutocompleteSuggestion = z.infer<typeof AutocompleteSuggestion>;

export const AutocompleteResponse = z.object({
  suggestions: z.array(AutocompleteSuggestion),
});
export type AutocompleteResponse = z.infer<typeof AutocompleteResponse>;

export const PlaceDetailsQuery = z.object({ sessionToken: z.uuid() });
export type PlaceDetailsQuery = z.infer<typeof PlaceDetailsQuery>;

export const PlaceDetails = z.object({
  placeId: z.string(),
  formattedAddress: z.string(),
  location: LatLng,
});
export type PlaceDetails = z.infer<typeof PlaceDetails>;

export const ReverseGeocodeQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});
export type ReverseGeocodeQuery = z.infer<typeof ReverseGeocodeQuery>;

export const ReverseGeocodeResponse = z.object({
  formattedAddress: z.string().nullable(),
});
export type ReverseGeocodeResponse = z.infer<typeof ReverseGeocodeResponse>;

/** Conductor cercano tal como lo ve un pasajero: sin ID y con posición aproximada (8.5). */
export const NearbyDriver = z.object({
  position: LatLng,
  heading: z.number().min(0).max(360).nullable(),
});
export type NearbyDriver = z.infer<typeof NearbyDriver>;

export const NearbyDriversResponse = z.object({
  drivers: z.array(NearbyDriver).max(10),
});
export type NearbyDriversResponse = z.infer<typeof NearbyDriversResponse>;
