import type { LatLng } from '@rideapp/contracts';
import { haversineMeters } from '@rideapp/contracts';

export interface SimulatedPosition {
  position: LatLng;
  /** Rumbo en grados (0 = norte, sentido horario). */
  heading: number;
}

function bearing(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Recorre una ruta cerrada a velocidad constante. Es determinista: la posición
 * depende solo del tiempo transcurrido, lo que facilita los tests.
 */
export class RouteWalker {
  private readonly segments: { from: LatLng; to: LatLng; length: number }[];
  readonly totalLength: number;

  constructor(
    route: readonly LatLng[],
    private readonly speedMps: number,
    private readonly offsetMeters = 0,
  ) {
    if (route.length < 2) throw new Error('La ruta necesita al menos dos puntos');
    this.segments = [];
    for (let i = 0; i < route.length - 1; i++) {
      const from = route[i]!;
      const to = route[i + 1]!;
      this.segments.push({ from, to, length: haversineMeters(from, to) });
    }
    this.totalLength = this.segments.reduce((sum, s) => sum + s.length, 0);
  }

  positionAt(elapsedMs: number): SimulatedPosition {
    let d = (this.offsetMeters + (this.speedMps * elapsedMs) / 1000) % this.totalLength;
    for (const s of this.segments) {
      if (d <= s.length) {
        const t = s.length === 0 ? 0 : d / s.length;
        return {
          position: {
            lat: s.from.lat + (s.to.lat - s.from.lat) * t,
            lng: s.from.lng + (s.to.lng - s.from.lng) * t,
          },
          heading: Math.round(bearing(s.from, s.to)),
        };
      }
      d -= s.length;
    }
    const last = this.segments.at(-1)!;
    return { position: last.to, heading: Math.round(bearing(last.from, last.to)) };
  }
}
