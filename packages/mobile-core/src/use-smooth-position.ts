import { haversineMeters, type LatLng } from '@rideapp/contracts';
import { useEffect, useRef, useState } from 'react';

/** Más lejos que esto no se anima: es un salto (reconexión, primera posición). */
const MAX_ANIMATED_METERS = 1000;
/** ~20 fotogramas por segundo bastan para un marcador y no saturan el puente con el mapa. */
const FRAME_MS = 50;

/**
 * Posición interpolada entre actualizaciones (9.4, paso 2): el conductor envía su ubicación cada
 * 4–5 s y el marcador avanza poco a poco durante ese intervalo, en vez de saltar.
 */
export function useSmoothPosition(target: LatLng | null): LatLng | null {
  const [position, setPosition] = useState<LatLng | null>(target);
  const current = useRef<LatLng | null>(target);
  const lastTargetAt = useRef(0);

  const lat = target?.lat;
  const lng = target?.lng;
  useEffect(() => {
    if (lat === undefined || lng === undefined) {
      current.current = null;
      lastTargetAt.current = 0;
      return;
    }
    const to = { lat, lng };
    const from = current.current;
    const now = Date.now();
    const gap = lastTargetAt.current ? now - lastTargetAt.current : 0;
    lastTargetAt.current = now;
    // Un salto se pinta en el primer fotograma, sin animación.
    const jump = !from || gap === 0 || haversineMeters(from, to) > MAX_ANIMATED_METERS;
    // Dura lo mismo que el intervalo entre posiciones, para llegar justo cuando llega la siguiente.
    const duration = jump ? 0 : Math.min(5000, Math.max(500, gap)) * 0.9;
    const origin = from ?? to;
    const start = now;
    let last = 0;
    let frame = 0;
    const tick = () => {
      const t = duration === 0 ? 1 : Math.min(1, (Date.now() - start) / duration);
      if (t === 1 || Date.now() - last >= FRAME_MS) {
        last = Date.now();
        const p = {
          lat: origin.lat + (to.lat - origin.lat) * t,
          lng: origin.lng + (to.lng - origin.lng) * t,
        };
        current.current = p;
        setPosition(p);
      }
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [lat, lng]);

  return target ? position : null;
}
