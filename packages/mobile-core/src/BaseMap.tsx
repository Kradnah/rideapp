import { GIRARDOT_CENTER, type LatLng } from '@rideapp/contracts';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, useColorScheme } from 'react-native';
import MapView, { PROVIDER_GOOGLE, type EdgePadding } from 'react-native-maps';
import { colors } from '@rideapp/ui';

export interface BaseMapProps {
  /**
   * false si la build no tiene clave de Maps SDK: sin clave, el SDK de Google en Android
   * se cierra al crear el mapa, así que se muestra un aviso en su lugar.
   */
  enabled: boolean;
  /** Espacio reservado para paneles inferiores. El logo de Google debe seguir visible (9.2). */
  mapPadding?: EdgePadding;
  showsUserLocation?: boolean;
  /** Si cambia, la cámara se mueve hasta ese punto (p. ej. la ubicación del usuario). */
  center?: LatLng | null;
  /** Encuadra estos puntos (p. ej. la ruta cotizada) respetando `mapPadding`. */
  fitTo?: LatLng[] | null;
  /**
   * Centro de la cámara (el del área sin `mapPadding`) cuando el usuario deja de mover el mapa,
   * para "fijar en el mapa" (9.3, paso 2).
   */
  onRegionChangeComplete?: (center: LatLng) => void;
  children?: ReactNode;
}

const INITIAL_REGION = {
  latitude: GIRARDOT_CENTER.lat,
  longitude: GIRARDOT_CENTER.lng,
  latitudeDelta: 0.06,
  longitudeDelta: 0.06,
};

/** Mapa de Google centrado en Girardot (7.6, paso 5). Siempre `PROVIDER_GOOGLE`, también en iOS (12.3). */
export function BaseMap({
  enabled,
  mapPadding,
  showsUserLocation = false,
  center,
  fitTo,
  onRegionChangeComplete,
  children,
}: BaseMapProps) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const palette = colors[scheme];
  // react-native-maps 1.27 se cierra en Android si mapPadding cambia antes de que el mapa de
  // Google esté listo (GoogleMap todavía null). Por eso el padding se aplica tras onMapReady.
  const [mapReady, setMapReady] = useState(false);
  const mapRef = useRef<MapView>(null);

  useEffect(() => {
    if (!mapReady || !center) return;
    mapRef.current?.animateCamera(
      { center: { latitude: center.lat, longitude: center.lng }, zoom: 15 },
      { duration: 600 },
    );
  }, [mapReady, center]);

  // Clave por valor: un array nuevo con los mismos puntos no vuelve a mover la cámara.
  const fitKey = fitTo?.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|') ?? '';
  const fitPoints = useMemo(
    () =>
      fitKey
        ? fitKey.split('|').map((pair) => {
            const [latitude, longitude] = pair.split(',').map(Number);
            return { latitude: latitude!, longitude: longitude! };
          })
        : null,
    [fitKey],
  );
  useEffect(() => {
    if (!mapReady || !fitPoints) return;
    mapRef.current?.fitToCoordinates(fitPoints, {
      edgePadding: { top: 60, right: 50, bottom: 60, left: 50 },
      animated: true,
    });
  }, [mapReady, fitPoints]);

  if (!enabled) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.placeholder, { backgroundColor: palette.bg }]}>
        <Text style={[styles.placeholderTitle, { color: palette.text }]}>Mapa desactivado</Text>
        <Text style={[styles.placeholderText, { color: palette.textMuted }]}>
          Esta build no tiene clave de Maps SDK for Android. Define GOOGLE_MAPS_ANDROID_KEY en
          .env.local y vuelve a compilar.
        </Text>
      </View>
    );
  }

  return (
    <MapView
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      provider={PROVIDER_GOOGLE}
      initialRegion={INITIAL_REGION}
      mapPadding={mapReady ? mapPadding : undefined}
      onMapReady={() => setMapReady(true)}
      onRegionChangeComplete={
        onRegionChangeComplete
          ? () => {
              // El centro de la cámara respeta mapPadding; el de la región visible, no.
              void mapRef.current?.getCamera().then(
                ({ center }) =>
                  onRegionChangeComplete({ lat: center.latitude, lng: center.longitude }),
                () => undefined,
              );
            }
          : undefined
      }
      showsUserLocation={showsUserLocation}
      showsMyLocationButton={false}
      toolbarEnabled={false}
      userInterfaceStyle={scheme}
    >
      {children}
    </MapView>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 8,
  },
  placeholderTitle: { fontSize: 18, fontWeight: '600' },
  placeholderText: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
