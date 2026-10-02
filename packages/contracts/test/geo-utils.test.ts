import { describe, expect, it } from 'vitest';
import { DEMO_DRIVER_ROUTE, FIXTURE_PLACES, searchFixturePlaces } from '../src/fixtures.js';
import {
  decodePolyline,
  encodePolyline,
  haversineMeters,
  isInServiceAreaBounds,
} from '../src/index.js';

describe('polilíneas', () => {
  it('codifica el ejemplo de la documentación de Google', () => {
    const pts = [
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ];
    expect(encodePolyline(pts)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual(pts);
  });
  it('ida y vuelta conserva la ruta de demo', () => {
    expect(decodePolyline(encodePolyline(DEMO_DRIVER_ROUTE))).toEqual(DEMO_DRIVER_ROUTE);
  });
  it('rechaza polilíneas truncadas', () => {
    expect(() => decodePolyline('_p~iF~ps|U_')).toThrow();
  });
});

describe('haversineMeters', () => {
  it('Girardot → Bogotá ronda los 92 km en línea recta', () => {
    const d = haversineMeters({ lat: 4.3035, lng: -74.8036 }, { lat: 4.711, lng: -74.0721 });
    expect(d).toBeGreaterThan(90_000);
    expect(d).toBeLessThan(95_000);
  });
  it('es 0 para el mismo punto', () => {
    expect(haversineMeters({ lat: 4.3, lng: -74.8 }, { lat: 4.3, lng: -74.8 })).toBe(0);
  });
});

describe('fixtures', () => {
  it('todos los lugares y la ruta están dentro de la zona de servicio', () => {
    for (const p of FIXTURE_PLACES) expect(isInServiceAreaBounds(p.location)).toBe(true);
    for (const p of DEMO_DRIVER_ROUTE) expect(isInServiceAreaBounds(p)).toBe(true);
  });
  it('la búsqueda ignora tildes y mayúsculas', () => {
    expect(searchFixturePlaces('PENALISA')[0]?.placeId).toBe('fake-penalisa');
    expect(searchFixturePlaces('ferreo')[0]?.placeId).toBe('fake-puente-ferreo');
  });
});
