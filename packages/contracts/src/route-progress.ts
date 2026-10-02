import type { LatLng } from './common.js';

/** Metros por grado de latitud (esfera media, como `haversineMeters`). */
const METERS_PER_DEGREE = (6_371_008.8 * Math.PI) / 180;

export interface RouteProgress {
  /** Punto de la ruta más cercano a la posición. */
  projected: LatLng;
  /** Índice del tramo (`route[i]` → `route[i + 1]`) donde cae `projected`. */
  segmentIndex: number;
  /** Lo que falta por la ruta desde `projected` hasta el final. */
  remainingMeters: number;
  /** Longitud total de la ruta. */
  totalMeters: number;
  /** Distancia de la posición a la ruta (si es grande, el conductor se desvió). */
  offRouteMeters: number;
}

/**
 * Avance de una posición sobre una ruta (9.4, paso 2): se proyecta el punto sobre el tramo más
 * cercano y se mide lo que queda hasta el final. Así el ETA se estima con cada posición sin volver
 * a pedir la ruta a Google. Usa una proyección plana local: en distancias de una ciudad el error
 * es despreciable.
 */
export function routeProgress(route: readonly LatLng[], position: LatLng): RouteProgress {
  if (route.length === 0) throw new Error('Ruta vacía');
  const path = route.length === 1 ? [route[0]!, route[0]!] : route;
  const lat0 = (path[0]!.lat * Math.PI) / 180;
  const kx = Math.cos(lat0) * METERS_PER_DEGREE;
  const toXY = (p: LatLng) => ({ x: p.lng * kx, y: p.lat * METERS_PER_DEGREE });

  const pos = toXY(position);
  const pts = path.map(toXY);
  const lengths: number[] = [];
  let best = { dist: Infinity, index: 0, t: 0 };

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    lengths.push(Math.sqrt(len2));
    const t = len2 === 0 ? 0 : clamp(((pos.x - a.x) * dx + (pos.y - a.y) * dy) / len2, 0, 1);
    const dist = Math.hypot(pos.x - (a.x + t * dx), pos.y - (a.y + t * dy));
    // `<` y no `<=`: ante un empate se queda el tramo anterior (no se salta parte de la ruta).
    if (dist < best.dist) best = { dist, index: i, t };
  }

  const totalMeters = lengths.reduce((sum, l) => sum + l, 0);
  let remainingMeters = (1 - best.t) * lengths[best.index]!;
  for (let i = best.index + 1; i < lengths.length; i++) remainingMeters += lengths[i]!;

  const a = path[best.index]!;
  const b = path[best.index + 1]!;
  return {
    projected: { lat: a.lat + best.t * (b.lat - a.lat), lng: a.lng + best.t * (b.lng - a.lng) },
    segmentIndex: best.index,
    remainingMeters,
    totalMeters,
    offRouteMeters: best.dist,
  };
}

/** La parte de la ruta que falta por recorrer, desde la posición proyectada. */
export function remainingPath(route: readonly LatLng[], progress: RouteProgress): LatLng[] {
  return [progress.projected, ...route.slice(progress.segmentIndex + 1)];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
