import { GIRARDOT_CENTER, type LatLng } from '@rideapp/contracts';
import { useEffect, useRef, useState, type ReactNode } from 'react';
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
