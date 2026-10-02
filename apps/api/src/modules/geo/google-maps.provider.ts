import type { AutocompleteSuggestion, LatLng, PlaceDetails } from '@rideapp/contracts';
import { SERVICE_AREA_BOUNDS } from '@rideapp/contracts';
import {
  type MapsProvider,
  MapsQuotaExceededError,
  MapsUnavailableError,
  type RouteResult,
} from './maps-provider.js';

const PLACES_URL = 'https://places.googleapis.com/v1';
const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

/** Cada llamada tiene 3 s y un único reintento con espera (8.6, paso 5). */
const TIMEOUT_MS = 3_000;
const RETRY_DELAY_MS = 250;

/** Solo estos campos: pedir más (displayName, fotos, reseñas) cambia el cobro a un SKU más caro. */
const PLACE_FIELDS = 'id,formattedAddress,location';
const ROUTE_FIELDS = 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline';

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`HTTP ${status}`);
  }
}

function isQuotaError(status: number, body: string): boolean {
  return status === 429 || body.includes('RESOURCE_EXHAUSTED');
}

interface PlacesAutocompleteResponse {
  suggestions?: {
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
    };
  }[];
}

interface PlaceResponse {
  id?: string;
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
}

interface GeocodeResponse {
  status?: string;
  results?: { formatted_address?: string }[];
}

interface RoutesResponse {
  routes?: {
    distanceMeters?: number;
    duration?: string;
    polyline?: { encodedPolyline?: string };
  }[];
}

/**
 * Google Maps Platform, llamado solo desde el backend (8.6): Places API (New), Geocoding y
 * Routes `computeRoutes` sin tráfico (SKU Essentials). La clave de servidor nunca sale del VPS.
 */
export class GoogleMapsProvider implements MapsProvider {
  readonly name = 'google' as const;

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  async autocomplete(query: string, sessionToken: string): Promise<AutocompleteSuggestion[]> {
    const b = SERVICE_AREA_BOUNDS;
    const res = await this.json<PlacesAutocompleteResponse>(`${PLACES_URL}/places:autocomplete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify({
        input: query,
        sessionToken,
        languageCode: 'es',
        includedRegionCodes: ['co'],
        // Solo lugares dentro de Girardot, Ricaurte y Flandes.
        locationRestriction: {
          rectangle: {
            low: { latitude: b.south, longitude: b.west },
            high: { latitude: b.north, longitude: b.east },
          },
        },
      }),
    });
    return (res.suggestions ?? []).flatMap(({ placePrediction: p }) => {
      if (!p?.placeId) return [];
      const primary = p.structuredFormat?.mainText?.text ?? p.text?.text;
      if (!primary) return [];
      return [
        {
          placeId: p.placeId,
          primaryText: primary,
          secondaryText: p.structuredFormat?.secondaryText?.text ?? null,
        },
      ];
    });
  }

  async placeDetails(placeId: string, sessionToken: string): Promise<PlaceDetails | null> {
    const url = `${PLACES_URL}/places/${encodeURIComponent(placeId)}?languageCode=es&sessionToken=${encodeURIComponent(sessionToken)}`;
    let res: PlaceResponse;
    try {
      res = await this.json<PlaceResponse>(url, {
        method: 'GET',
        headers: { 'x-goog-api-key': this.apiKey, 'x-goog-fieldmask': PLACE_FIELDS },
      });
    } catch (err) {
      if (err instanceof HttpError && (err.status === 404 || err.status === 400)) return null;
      throw err;
    }
    const lat = res.location?.latitude;
    const lng = res.location?.longitude;
    if (!res.id || !res.formattedAddress || lat === undefined || lng === undefined) return null;
    return { placeId: res.id, formattedAddress: res.formattedAddress, location: { lat, lng } };
  }

  async reverseGeocode({ lat, lng }: LatLng): Promise<string | null> {
    const url = `${GEOCODE_URL}?latlng=${lat},${lng}&language=es&key=${encodeURIComponent(this.apiKey)}`;
    const res = await this.json<GeocodeResponse>(url, { method: 'GET' });
    // Geocoding (legacy) responde 200 con el error en `status`.
    switch (res.status) {
      case 'OK':
        return res.results?.[0]?.formatted_address ?? null;
      case 'ZERO_RESULTS':
        return null;
      case 'OVER_QUERY_LIMIT':
      case 'OVER_DAILY_LIMIT':
        throw new MapsQuotaExceededError(`Geocoding: ${res.status}`);
      default:
        throw new MapsUnavailableError(`Geocoding: ${res.status ?? 'sin estado'}`);
    }
  }

  async route(origin: LatLng, destination: LatLng): Promise<RouteResult> {
    const point = ({ lat, lng }: LatLng) => ({
      location: { latLng: { latitude: lat, longitude: lng } },
    });
    const res = await this.json<RoutesResponse>(ROUTES_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': this.apiKey,
        'x-goog-fieldmask': ROUTE_FIELDS,
      },
      body: JSON.stringify({
        origin: point(origin),
        destination: point(destination),
        travelMode: 'DRIVE',
        // Sin tráfico: SKU Essentials. Con tráfico pasa a Pro (más caro y con menos cupo).
        routingPreference: 'TRAFFIC_UNAWARE',
        languageCode: 'es',
        units: 'METRIC',
      }),
    });
    const route = res.routes?.[0];
    const seconds = Number.parseInt(route?.duration ?? '', 10);
    if (!route?.polyline?.encodedPolyline || !Number.isFinite(seconds)) {
      throw new MapsUnavailableError('Routes: sin ruta');
    }
    return {
      distanceMeters: route.distanceMeters ?? 0,
      durationSeconds: seconds,
      polyline: route.polyline.encodedPolyline,
    };
  }

  /** Petición con timeout y un reintento ante fallos de red o 5xx (nunca ante 4xx ni cuota). */
  private async json<T>(url: string, init: RequestInit): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.once<T>(url, init);
      } catch (err) {
        if (err instanceof HttpError && isQuotaError(err.status, err.body)) {
          throw new MapsQuotaExceededError(`Google: cuota agotada (${err.status})`);
        }
        const retriable = !(err instanceof HttpError) || err.status >= 500;
        if (!retriable) throw err;
        if (attempt >= 1) {
          throw new MapsUnavailableError(
            err instanceof Error ? `Google: ${err.message}` : 'Google: error desconocido',
          );
        }
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }

  private async once<T>(url: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(url, { ...init, signal: controller.signal });
      const text = await res.text();
      if (!res.ok) throw new HttpError(res.status, text.slice(0, 500));
      return JSON.parse(text) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
