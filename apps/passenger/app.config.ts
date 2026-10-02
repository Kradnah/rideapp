import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Configuración de la app del pasajero (7.6).
 * Las claves llegan por variables de entorno de build (apps/passenger/.env.local o EAS Secrets),
 * nunca escritas en el código. Todo lo que acaba en el bundle es público.
 */
const ANDROID_MAPS_KEY = process.env.GOOGLE_MAPS_ANDROID_KEY;
const IOS_MAPS_KEY = process.env.GOOGLE_MAPS_IOS_KEY;
// Push (8.13): proyecto de EAS (gratis) y, en Android, el google-services.json de Firebase para
// FCM. Sin ellos la app compila igual y simplemente no recibe notificaciones.
const EAS_PROJECT_ID = process.env.EAS_PROJECT_ID;
const GOOGLE_SERVICES_FILE = process.env.GOOGLE_SERVICES_FILE;

// Identificador base de las apps. Debe quedar fijo antes de registrar las claves de Google
// (Maps y OAuth se restringen por nombre de paquete + SHA-1).
const APP_ID = 'com.norta.rideapp.passenger';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'rideapp',
  slug: 'rideapp-passenger',
  scheme: 'rideapp-passenger',
  version: '0.6.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  android: {
    package: APP_ID,
    ...(GOOGLE_SERVICES_FILE ? { googleServicesFile: GOOGLE_SERVICES_FILE } : {}),
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // El pasajero solo usa la ubicación mientras la app está abierta (9.2).
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'],
    blockedPermissions: ['ACCESS_BACKGROUND_LOCATION'],
  },
  ios: {
    bundleIdentifier: APP_ID,
    supportsTablet: false,
  },
  plugins: [
    'expo-router',
    // Solo Windows: CMake con ninja que soporta rutas largas (ver el propio plugin).
    '@rideapp/mobile-core/plugins/with-windows-cmake',
    ['expo-notifications', { color: '#0f766e' }],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'rideapp usa tu ubicación para fijar el punto de recogida y mostrarte los conductores cercanos.',
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
    ...(EAS_PROJECT_ID ? { eas: { projectId: EAS_PROJECT_ID } } : {}),
    // Sin clave, el SDK de Google se cierra al crear el mapa: la app muestra un aviso en su lugar.
    mapsEnabled: Boolean(ANDROID_MAPS_KEY),
  },
});
