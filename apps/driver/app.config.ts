import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Configuración de la app del conductor (7.6).
 * Las claves llegan por variables de entorno de build (apps/driver/.env.local o EAS Secrets),
 * nunca escritas en el código. Todo lo que acaba en el bundle es público.
 */
const ANDROID_MAPS_KEY = process.env.GOOGLE_MAPS_ANDROID_KEY;
const IOS_MAPS_KEY = process.env.GOOGLE_MAPS_IOS_KEY;

// Identificador base de las apps. Debe quedar fijo antes de registrar las claves de Google
// (Maps y OAuth se restringen por nombre de paquete + SHA-1).
const APP_ID = 'com.norta.rideapp.driver';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'rideapp Conductor',
  slug: 'rideapp-driver',
  scheme: 'rideapp-driver',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  android: {
    package: APP_ID,
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // La ubicación en segundo plano (10.2) se activa en la Fase 2, junto con el servicio en primer
    // plano y la declaración para Google Play. Hasta entonces, solo mientras la app está abierta.
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'],
    blockedPermissions: ['ACCESS_BACKGROUND_LOCATION'],
  },
  ios: {
    bundleIdentifier: APP_ID,
    supportsTablet: false,
  },
  plugins: [
    'expo-router',
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'rideapp Conductor usa tu ubicación para recibir solicitudes de viaje cercanas mientras estás en línea.',
        isAndroidBackgroundLocationEnabled: false,
        isIosBackgroundLocationEnabled: false,
      },
    ],
    [
      'react-native-maps',
      {
        ...(ANDROID_MAPS_KEY ? { androidGoogleMapsApiKey: ANDROID_MAPS_KEY } : {}),
        ...(IOS_MAPS_KEY ? { iosGoogleMapsApiKey: IOS_MAPS_KEY } : {}),
      },
    ],
  ],
  experiments: { typedRoutes: true },
  extra: {
    // Sin clave, el SDK de Google se cierra al crear el mapa: la app muestra un aviso en su lugar.
    mapsEnabled: Boolean(ANDROID_MAPS_KEY),
  },
});
