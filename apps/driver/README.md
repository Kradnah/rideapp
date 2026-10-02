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
