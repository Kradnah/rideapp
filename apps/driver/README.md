# driver

App del conductor (Expo SDK 57, React Native 0.86, Expo Router). Ver secciones 7.6 y 10 del plan.

## Primera vez

1. Variables de entorno de Windows (una sola vez, en una terminal nueva después):
   - `ANDROID_HOME=D:\AndroidStudio`
   - `JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-17.0.20.101-hotspot` (JDK 17: el JDK 25 que trae Android Studio rompe la configuración de CMake)
   - Añadir `%ANDROID_HOME%\platform-tools` al `PATH` (para `adb`).
2. `cp apps/driver/.env.example apps/driver/.env.local` y, cuando la tengas, pon la clave de Maps.

## Desarrollo

```bash
pnpm --filter @rideapp/mock-server dev     # API falsa en :4000
pnpm --filter @rideapp/driver android        # compila el dev build, lo instala y abre Metro
# Más rápido en el emulador: solo x86_64
# cd apps/driver/android && ./gradlew assembleDebug -PreactNativeArchitectures=x86_64
```

Después de la primera compilación basta con `pnpm --filter @rideapp/driver start` (Metro). Solo hace falta recompilar si cambian dependencias nativas, permisos o claves de `app.config.ts`.

- Es un _development build_ (`expo-dev-client`), no Expo Go: Google Maps y Google Sign-In usan código nativo.
- `android/` lo genera `expo prebuild`: no se versiona ni se edita a mano. Los cambios van en `app.config.ts`.
- Sin `GOOGLE_MAPS_ANDROID_KEY` la app muestra un aviso en lugar del mapa: sin clave, el SDK de Google se cierra.

## Registro y "En línea" (Fase 2)

- Sin cuenta aprobada, la app abre el registro: datos (licencia y celular) → vehículo → documentos (cámara o selector del sistema, comprimidos a ~1600 px) → enviar a revisión. Mientras espera, consulta el estado cada 30 s.
- "En línea" pide la ubicación en uso y, explicándolo antes, "Todo el tiempo". Con ese permiso, la ubicación se envía con un servicio en primer plano y notificación fija ("Estás en línea"); sin él, solo con la app abierta (la app lo avisa).
- Se envía cada 12 s (lo dice el servidor) **sin `distanceInterval`**: parado también hay que enviar, o el servidor lo saca de línea a los 60 s.
- Al pasar a "Fuera de línea", al recibir `driver.availability.v1` (suspensión o inactividad) o si el servidor responde `OFFLINE`, se detiene todo el rastreo.
- **Google Play:** la ubicación en segundo plano exige rellenar la declaración de permisos (con vídeo) antes de publicar. Para la demo con APK no hace falta.
- Probar contra el API local: `EXPO_PUBLIC_API_URL=http://10.0.2.2:3000/api EXPO_PUBLIC_SOCKET_URL=http://10.0.2.2:3000 pnpm --filter @rideapp/driver start`. En el emulador, mover el GPS con `adb emu geo fix <lng> <lat>`.
