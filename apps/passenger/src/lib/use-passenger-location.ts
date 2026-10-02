import { isInServiceAreaBounds, type LatLng } from '@rideapp/contracts';
import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';

export type LocationPermission = 'checking' | 'undetermined' | 'granted' | 'denied';

/**
 * Ubicación del pasajero solo mientras usa la app (9.2, paso 2): nunca en segundo plano.
 * El permiso se pide desde un botón que explica para qué, no al abrir la app.
 */
export function usePassengerLocation() {
  const [permission, setPermission] = useState<LocationPermission>('checking');
  const [position, setPosition] = useState<LatLng | null>(null);

  const locate = useCallback(async () => {
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setPosition({ lat: loc.coords.latitude, lng: loc.coords.longitude });
    } catch {
      // GPS apagado o sin señal: se sigue con el centro de Girardot.
    }
  }, []);

  useEffect(() => {
    void Location.getForegroundPermissionsAsync().then((res) => {
      const next = res.granted ? 'granted' : res.canAskAgain ? 'undetermined' : 'denied';
      setPermission(next);
      if (next === 'granted') void locate();
    });
  }, [locate]);

  const request = useCallback(async () => {
    const res = await Location.requestForegroundPermissionsAsync();
    setPermission(res.granted ? 'granted' : 'denied');
    if (res.granted) await locate();
  }, [locate]);

  return {
    permission,
    position,
    /** Fuera de la zona de servicio no hay conductores que mostrar: se usa el centro. */
    inServiceArea: position ? isInServiceAreaBounds(position) : null,
    request,
    locate,
  };
}
