import { GIRARDOT_CENTER } from '@rideapp/contracts';
import { useState, type ReactNode } from 'react';
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
  children,
}: BaseMapProps) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const palette = colors[scheme];
  // react-native-maps 1.27 se cierra en Android si mapPadding cambia antes de que el mapa de
  // Google esté listo (GoogleMap todavía null). Por eso el padding se aplica tras onMapReady.
  const [mapReady, setMapReady] = useState(false);

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
