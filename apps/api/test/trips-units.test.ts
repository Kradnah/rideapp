import { approximateArea, GIRARDOT_CENTER, TripStatus } from '@rideapp/contracts';
import { describe, expect, it } from 'vitest';
import { GoogleMapsProvider } from '../src/modules/geo/google-maps.provider.js';
import { MapsQuotaExceededError, MapsUnavailableError } from '../src/modules/geo/maps-provider.js';
import { estimateEta } from '../src/modules/trips/live-trip.service.js';
import {
  canTransition,
  isTerminal,
  TRIP_TRANSITIONS,
} from '../src/modules/trips/trip-state.machine.js';

describe('máquina de estados del viaje', () => {
  it('el camino feliz, cada paso con su actor', () => {
    expect(canTransition('REQUESTED', 'SEARCHING', 'SYSTEM')).toBe(true);
    expect(canTransition('SEARCHING', 'DRIVER_ASSIGNED', 'DRIVER')).toBe(true);
    expect(canTransition('DRIVER_ASSIGNED', 'DRIVER_ARRIVED', 'DRIVER')).toBe(true);
    expect(canTransition('DRIVER_ARRIVED', 'IN_PROGRESS', 'DRIVER')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'COMPLETED', 'DRIVER')).toBe(true);
  });

  it('nadie se salta pasos ni actúa por otro', () => {
    expect(canTransition('SEARCHING', 'DRIVER_ASSIGNED', 'PASSENGER')).toBe(false);
    expect(canTransition('SEARCHING', 'IN_PROGRESS', 'DRIVER')).toBe(false);
    expect(canTransition('DRIVER_ASSIGNED', 'COMPLETED', 'DRIVER')).toBe(false);
    expect(canTransition('SEARCHING', 'NO_DRIVERS', 'PASSENGER')).toBe(false);
    // Un viaje en curso no se cancela (se termina).
    expect(canTransition('IN_PROGRESS', 'CANCELLED', 'PASSENGER')).toBe(false);
    // El conductor no cancela algo que aún no es suyo.
    expect(canTransition('SEARCHING', 'CANCELLED', 'DRIVER')).toBe(false);
  });

  it('los estados finales no tienen salida y todos los estados están en la tabla', () => {
    for (const status of TripStatus.options) expect(TRIP_TRANSITIONS[status]).toBeDefined();
    expect(['COMPLETED', 'CANCELLED', 'NO_DRIVERS'].every((s) => isTerminal(s as TripStatus))).toBe(
      true,
    );
    expect(isTerminal('SEARCHING')).toBe(false);
  });
});

describe('ETA del viaje en vivo', () => {
  const target = GIRARDOT_CENTER;
  const start = { lat: 4.3125, lng: -74.8036 };
  const route = { points: [start, target], durationSeconds: 300 };

  it('proporcional a lo que falta de la ruta, sin pedir otra', () => {
    expect(estimateEta({ target, route }, start)).toEqual({ seconds: 300, needsRoute: false });
    const half = { lat: (start.lat + target.lat) / 2, lng: target.lng };
    expect(estimateEta({ target, route }, half)).toEqual({ seconds: 150, needsRoute: false });
    expect(estimateEta({ target, route }, target).seconds).toBe(0);
  });

  it('desviado más de 200 m, o sin ruta todavía: estimación en línea recta y ruta nueva', () => {
    const detour = { lat: (start.lat + target.lat) / 2, lng: target.lng + 0.003 };
    const off = estimateEta({ target, route }, detour);
    expect(off.needsRoute).toBe(true);
    expect(off.seconds).toBeGreaterThan(150);
    const noRoute = estimateEta({ target, route: null }, start);
    expect(noRoute.needsRoute).toBe(true);
    // ~1 km × 1,3 a 25 km/h.
    expect(noRoute.seconds).toBeGreaterThan(150);
    expect(noRoute.seconds).toBeLessThan(220);
  });
});

describe('approximateArea', () => {
  it('describe un punto por su municipio, sin la dirección', () => {
    expect(approximateArea(GIRARDOT_CENTER)).toBe('Girardot');
    expect(approximateArea({ lat: 4.284, lng: -74.818 })).toBe('Flandes');
    expect(approximateArea({ lat: 4.279, lng: -74.77 })).toBe('Ricaurte');
  });
});

/** fetch falso que responde en orden y guarda las peticiones. */
function fakeFetch(...responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('sin más respuestas');
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('GoogleMapsProvider', () => {
  it('Routes: sin tráfico, con field mask mínima y la clave en cabecera', async () => {
    const f = fakeFetch(
      json({
        routes: [{ distanceMeters: 2450, duration: '412s', polyline: { encodedPolyline: 'abc' } }],
      }),
    );
    const provider = new GoogleMapsProvider('clave-servidor', f.impl);
    const route = await provider.route(GIRARDOT_CENTER, { lat: 4.2955, lng: -74.788 });
    expect(route).toEqual({ distanceMeters: 2450, durationSeconds: 412, polyline: 'abc' });

    const { url, init } = f.calls[0]!;
    expect(url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe('clave-servidor');
    expect(headers['x-goog-fieldmask']).toBe(
      'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
    );
    expect(JSON.parse(init.body as string)).toMatchObject({
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_UNAWARE',
    });
  });

  it('Place Details pide solo id, dirección y ubicación (SKU Essentials)', async () => {
    const f = fakeFetch(
      json({
        id: 'ChIJ123',
        formattedAddress: 'Cra. 10 #15-20, Girardot',
        location: { latitude: 4.3, longitude: -74.8 },
      }),
    );
    const place = await new GoogleMapsProvider('k', f.impl).placeDetails('ChIJ123', 'tok-1');
    expect(place).toEqual({
      placeId: 'ChIJ123',
      formattedAddress: 'Cra. 10 #15-20, Girardot',
      location: { lat: 4.3, lng: -74.8 },
    });
    expect(f.calls[0]!.url).toContain('sessionToken=tok-1');
    expect((f.calls[0]!.init.headers as Record<string, string>)['x-goog-fieldmask']).toBe(
      'id,formattedAddress,location',
    );
  });

  it('Autocomplete restringido a la zona y en español', async () => {
    const f = fakeFetch(
      json({
        suggestions: [
          {
            placePrediction: {
              placeId: 'p1',
              structuredFormat: {
                mainText: { text: 'Unicentro' },
                secondaryText: { text: 'Girardot, Cundinamarca' },
              },
            },
          },
          { queryPrediction: { text: { text: 'ignorada' } } },
        ],
      }),
    );
    const res = await new GoogleMapsProvider('k', f.impl).autocomplete('unic', 'tok');
    expect(res).toEqual([
      { placeId: 'p1', primaryText: 'Unicentro', secondaryText: 'Girardot, Cundinamarca' },
    ]);
    expect(JSON.parse(f.calls[0]!.init.body as string)).toMatchObject({
      languageCode: 'es',
      includedRegionCodes: ['co'],
      sessionToken: 'tok',
      locationRestriction: { rectangle: { low: { latitude: 4.22 } } },
    });
  });

  it('cuota agotada: error específico y sin reintento', async () => {
    const f = fakeFetch(json({ error: { status: 'RESOURCE_EXHAUSTED' } }, 429));
    await expect(
      new GoogleMapsProvider('k', f.impl).route(GIRARDOT_CENTER, GIRARDOT_CENTER),
    ).rejects.toBeInstanceOf(MapsQuotaExceededError);
    expect(f.calls).toHaveLength(1);

    const g = fakeFetch(json({ status: 'OVER_QUERY_LIMIT' }));
    await expect(
      new GoogleMapsProvider('k', g.impl).reverseGeocode(GIRARDOT_CENTER),
    ).rejects.toBeInstanceOf(MapsQuotaExceededError);
  });

  it('un fallo de red o 5xx se reintenta una vez', async () => {
    const ok = json({ status: 'OK', results: [{ formatted_address: 'Calle 1, Girardot' }] });
    const f = fakeFetch(new Error('ECONNRESET'), ok);
    expect(await new GoogleMapsProvider('k', f.impl).reverseGeocode(GIRARDOT_CENTER)).toBe(
      'Calle 1, Girardot',
    );
    expect(f.calls).toHaveLength(2);

    const g = fakeFetch(json({}, 503), json({}, 502));
    await expect(
      new GoogleMapsProvider('k', g.impl).route(GIRARDOT_CENTER, GIRARDOT_CENTER),
    ).rejects.toBeInstanceOf(MapsUnavailableError);
    expect(g.calls).toHaveLength(2);
  });
});
