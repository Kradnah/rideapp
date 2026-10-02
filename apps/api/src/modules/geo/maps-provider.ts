import type { AutocompleteSuggestion, LatLng, PlaceDetails } from '@rideapp/contracts';

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  /** Polilínea codificada en formato Google. */
  polyline: string;
}

/**
 * Abstracción del proveedor de mapas (8.6). Las apps nunca llaman a Google directamente:
 * pasan por el backend, que elige `GoogleMapsProvider` o `FakeMapsProvider` según `MAPS_PROVIDER`.
 */
export interface MapsProvider {
  readonly name: 'fake' | 'google';
  autocomplete(query: string, sessionToken: string): Promise<AutocompleteSuggestion[]>;
  placeDetails(placeId: string, sessionToken: string): Promise<PlaceDetails | null>;
  reverseGeocode(point: LatLng): Promise<string | null>;
  route(origin: LatLng, destination: LatLng): Promise<RouteResult>;
}

export const MAPS_PROVIDER = Symbol('MAPS_PROVIDER');
