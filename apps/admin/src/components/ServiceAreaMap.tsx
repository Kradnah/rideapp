import type { AdminLiveDriver } from '@rideapp/contracts';
import { GIRARDOT_CENTER, SERVICE_AREA_BOUNDS } from '@rideapp/contracts';
import { APIProvider, Map, useMap } from '@vis.gl/react-google-maps';
import { useEffect } from 'react';

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY;

/** Rectángulo de la zona de servicio sobre el mapa (7.4). */
function ServiceAreaRectangle() {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const rect = new google.maps.Rectangle({
      map,
      bounds: SERVICE_AREA_BOUNDS,
      strokeColor: '#0f766e',
      strokeWeight: 2,
      fillColor: '#0f766e',
      fillOpacity: 0.08,
      clickable: false,
    });
    return () => rect.setMap(null);
  }, [map]);
  return null;
}

/**
 * Conductores en línea como círculos (11.1, paso 4). Se usan círculos y no marcadores:
 * `google.maps.Marker` está obsoleto y `AdvancedMarker` exige un Map ID de Cloud Console.
 */
function DriverDots({ drivers }: { drivers: AdminLiveDriver[] }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const dots = drivers.flatMap((d) =>
      d.position
        ? [
            new google.maps.Circle({
              map,
              center: d.position,
              radius: 70,
              strokeColor: '#ffffff',
              strokeWeight: 2,
              fillColor: d.category === 'MOTO' ? '#a16207' : '#0f766e',
              fillOpacity: 0.95,
              clickable: false,
            }),
          ]
        : [],
    );
    return () => dots.forEach((c) => c.setMap(null));
  }, [map, drivers]);
  return null;
}

export function ServiceAreaMap({ drivers = [] }: { drivers?: AdminLiveDriver[] }) {
  if (!MAPS_KEY) {
    return (
      <div className="map map--empty">
        <p>
          <strong>Mapa desactivado.</strong> Define <code>VITE_GOOGLE_MAPS_KEY</code> (clave{' '}
          <code>maps-web-admin</code>, sección 12.5) en <code>apps/admin/.env.local</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="map">
      <APIProvider apiKey={MAPS_KEY} language="es" region="CO">
        <Map
          defaultCenter={GIRARDOT_CENTER}
          defaultZoom={13}
          gestureHandling="greedy"
          disableDefaultUI={false}
          clickableIcons={false}
        >
          <ServiceAreaRectangle />
          <DriverDots drivers={drivers} />
        </Map>
      </APIProvider>
    </div>
  );
}
