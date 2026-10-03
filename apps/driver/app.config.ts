import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Configuración de la app del conductor (7.6).
 * Las claves llegan por variables de entorno de build (apps/driver/.env.local o EAS Secrets),
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
const APP_ID = 'com.norta.rideapp.driver';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'rideapp Conductor',
  slug: 'rideapp-driver',
  scheme: 'rideapp-driver',
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
    // Ubicación en segundo plano solo mientras está en línea (10.2), con servicio en primer plano
    // y notificación fija. Google Play exige declararla y justificarla (formulario y vídeo).
    permissions: [
      'ACCESS_COARSE_LOCATION',
      'ACCESS_FINE_LOCATION',
      'ACCESS_BACKGROUND_LOCATION',
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_LOCATION',
      // Vibración al llegar una oferta de viaje (10.3, paso 1).
      'VIBRATE',
    ],
    // Las fotos de documentos se eligen con el selector del sistema: sin acceso a toda la galería.
    blockedPermissions: [
      'READ_MEDIA_IMAGES',
      'READ_MEDIA_VIDEO',
      'READ_EXTERNAL_STORAGE',
      'RECORD_AUDIO',
    ],
  },
  ios: {
    bundleIdentifier: APP_ID,
    supportsTablet: false,
  },
  plugins: [
    'expo-router',
    'expo-sharing',
    // Solo Windows: CMake con ninja que soporta rutas largas (ver el propio plugin).
    '@rideapp/mobile-core/plugins/with-windows-cmake',
    ['expo-notifications', { color: '#0f766e' }],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'rideapp Conductor usa tu ubicación para recibir solicitudes de viaje cercanas mientras estás en línea.',
        locationAlwaysAndWhenInUsePermission:
          'Mientras estás en línea, rideapp Conductor usa tu ubicación aunque la app esté en segundo plano, para ofrecerte viajes cercanos. Al desconectarte deja de usarla.',
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
        isIosBackgroundLocationEnabled: true,
      },
    ],
    [
      'expo-image-picker',
      {
        cameraPermission: 'rideapp Conductor usa la cámara para fotografiar tus documentos.',
        photosPermission: 'rideapp Conductor accede a las fotos que elijas de tus documentos.',
        microphonePermission: false,
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
