import { Injectable } from '@nestjs/common';
import type { AutocompleteSuggestion, LatLng, PlaceDetails } from '@rideapp/contracts';
import { encodePolyline, haversineMeters } from '@rideapp/contracts';
import { FIXTURE_PLACES, searchFixturePlaces } from '@rideapp/contracts/fixtures';
import type { MapsProvider, RouteResult } from './maps-provider.js';

/** Factor para aproximar la distancia por calles a partir de la línea recta (7.4). */
export const FAKE_ROUTE_FACTOR = 1.3;
/** Velocidad media urbana supuesta: 25 km/h. */
export const FAKE_AVG_SPEED_MPS = 25 / 3.6;
const REVERSE_MAX_DISTANCE_M = 1500;

/**
 * Proveedor sin red ni cuota: rutas en línea recta × 1,3 y lugares fijos de Girardot.
 * Es el valor por defecto en desarrollo y tests, y el respaldo si se agota la cuota de Google (12.4).
 */
@Injectable()
export class FakeMapsProvider implements MapsProvider {
  readonly name = 'fake' as const;

  async autocomplete(query: string, _sessionToken: string): Promise<AutocompleteSuggestion[]> {
    return searchFixturePlaces(query).map((p) => ({
      placeId: p.placeId,
      primaryText: p.name,
      secondaryText: p.formattedAddress,
    }));
  }

  async placeDetails(placeId: string, _sessionToken: string): Promise<PlaceDetails | null> {
    const place = FIXTURE_PLACES.find((p) => p.placeId === placeId);
    return place
      ? {
          placeId: place.placeId,
          formattedAddress: place.formattedAddress,
          location: place.location,
        }
      : null;
  }

  async reverseGeocode(point: LatLng): Promise<string | null> {
    let best: { address: string; distance: number } | null = null;
    for (const p of FIXTURE_PLACES) {
      const distance = haversineMeters(point, p.location);
      if (!best || distance < best.distance) best = { address: p.formattedAddress, distance };
    }
    return best && best.distance <= REVERSE_MAX_DISTANCE_M ? `Cerca de ${best.address}` : null;
  }

  async route(origin: LatLng, destination: LatLng): Promise<RouteResult> {
    const distanceMeters = Math.round(haversineMeters(origin, destination) * FAKE_ROUTE_FACTOR);
    return {
      distanceMeters,
      durationSeconds: Math.round(distanceMeters / FAKE_AVG_SPEED_MPS),
      polyline: encodePolyline([origin, destination]),
    };
  }
}
