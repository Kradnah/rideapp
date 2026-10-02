import { describe, expect, it } from 'vitest';
import { DEMO_DRIVER_ROUTE, FIXTURE_PLACES, searchFixturePlaces } from '../src/fixtures.js';
import {
  decodePolyline,
  encodePolyline,
  haversineMeters,
  isInServiceAreaBounds,
  remainingPath,
  routeProgress,
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

describe('routeProgress', () => {
  // Una "L": 1 km hacia el norte y luego ~1 km hacia el este.
  const start = { lat: 4.3, lng: -74.8 };
  const corner = { lat: 4.3 + 1000 / 111_195, lng: -74.8 };
  const end = { lat: corner.lat, lng: -74.8 + 1000 / (111_195 * Math.cos((4.3 * Math.PI) / 180)) };
  const route = [start, corner, end];

  it('al inicio falta toda la ruta y al final nada', () => {
    const atStart = routeProgress(route, start);
    expect(atStart.totalMeters).toBeCloseTo(2000, -1);
    expect(atStart.remainingMeters).toBeCloseTo(2000, -1);
    expect(atStart.offRouteMeters).toBeLessThan(1);
    expect(routeProgress(route, end).remainingMeters).toBeLessThan(1);
  });

  it('proyecta sobre el tramo más cercano y mide el desvío', () => {
    // A mitad del primer tramo, 100 m al oeste de la ruta.
    const p = { lat: (start.lat + corner.lat) / 2, lng: -74.8 - 100 / 111_000 };
    const progress = routeProgress(route, p);
    expect(progress.segmentIndex).toBe(0);
    expect(progress.remainingMeters).toBeCloseTo(1500, -1);
    expect(progress.offRouteMeters).toBeCloseTo(100, -1);
    expect(remainingPath(route, progress)).toEqual([progress.projected, corner, end]);
  });

  it('una ruta de un solo punto no falla', () => {
    const progress = routeProgress([start], corner);
    expect(progress.totalMeters).toBe(0);
    expect(progress.offRouteMeters).toBeCloseTo(1000, -1);
  });
});
