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

export function ServiceAreaMap() {
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
        </Map>
      </APIProvider>
    </div>
  );
}
