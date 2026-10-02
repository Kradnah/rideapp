import { decodePolyline, haversineMeters } from '@rideapp/contracts';
import { describe, expect, it } from 'vitest';
import { FAKE_ROUTE_FACTOR, FakeMapsProvider } from '../src/modules/geo/fake-maps.provider.js';

const maps = new FakeMapsProvider();
const parqueBolivar = { lat: 4.3036, lng: -74.803 };
const unicentro = { lat: 4.2955, lng: -74.788 };

describe('FakeMapsProvider', () => {
  it('ruta = línea recta × 1,3, con polilínea decodificable', async () => {
    const r = await maps.route(parqueBolivar, unicentro);
    expect(r.distanceMeters).toBe(
      Math.round(haversineMeters(parqueBolivar, unicentro) * FAKE_ROUTE_FACTOR),
    );
    expect(r.durationSeconds).toBeGreaterThan(0);
    expect(decodePolyline(r.polyline)).toEqual([parqueBolivar, unicentro]);
  });

  it('autocompleta y resuelve el lugar elegido', async () => {
    const [first] = await maps.autocomplete('unicentro', crypto.randomUUID());
    expect(first?.placeId).toBe('fake-unicentro');
    const place = await maps.placeDetails(first!.placeId, crypto.randomUUID());
    expect(place?.location).toEqual(unicentro);
  });

  it('lugar inexistente → null', async () => {
    expect(await maps.placeDetails('no-existe', crypto.randomUUID())).toBeNull();
  });

  it('geocodificación inversa solo cerca de un lugar conocido', async () => {
    expect(await maps.reverseGeocode({ lat: 4.3037, lng: -74.8031 })).toMatch(/Parque Bolívar/);
    expect(await maps.reverseGeocode({ lat: 4.711, lng: -74.0721 })).toBeNull();
  });
});
