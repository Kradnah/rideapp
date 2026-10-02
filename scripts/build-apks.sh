#!/bin/bash
# APK release de las apps contra producción (13.5 G), siempre en la misma carpeta:
#   D:\Server\rideapp-apks\rideapp-pasajero-<versión>.apk y rideapp-conductor-<versión>.apk
# La versión sale de `version` en app.config.ts de cada app.
#
# Uso (Git Bash, desde la raíz del repo):  scripts/build-apks.sh [passenger] [driver]
# Sin argumentos compila las dos. Necesita JDK 17 y el SDK de Android en D:\AndroidStudio.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${RIDEAPP_APKS_DIR:-/d/Server/rideapp-apks}

export JAVA_HOME=${JAVA_HOME:-"C:/Program Files/Eclipse Adoptium/jdk-17.0.20.101-hotspot"}
export ANDROID_HOME=${ANDROID_HOME:-"D:/AndroidStudio"}
export PATH="$JAVA_HOME/bin:$PATH"
# Las EXPO_PUBLIC_* se incrustan en el bundle; las del entorno ganan a las de .env.local.
export EXPO_PUBLIC_API_URL=https://rideapp-api.julian-lizcano.com/api
export EXPO_PUBLIC_SOCKET_URL=https://rideapp-api.julian-lizcano.com
export NODE_ENV=production

build() {
  local app=$1 name=$2 version log
  version=$(grep -oE "version: '[0-9.]+'" "$ROOT/apps/$app/app.config.ts" | grep -oE "[0-9.]+")
  log="$OUT/logs/$app-$version.log"
  mkdir -p "$OUT/logs"
  echo "== $app $version: prebuild"
  (cd "$ROOT/apps/$app" && npx expo prebuild -p android --no-install) > "$log" 2>&1
  echo "== $app $version: assembleRelease (log: $log)"
  if ! (cd "$ROOT/apps/$app/android" && ./gradlew assembleRelease --console=plain) >> "$log" 2>&1; then
    tail -40 "$log"
    exit 1
  fi
  cp "$ROOT/apps/$app/android/app/build/outputs/apk/release/app-release.apk" \
    "$OUT/rideapp-$name-$version.apk"
  echo "== $app $version: $OUT/rideapp-$name-$version.apk"
}

apps=("$@")
[ ${#apps[@]} -eq 0 ] && apps=(passenger driver)
for app in "${apps[@]}"; do
  case $app in
    passenger) build passenger pasajero ;;
    driver) build driver conductor ;;
    *) echo "App desconocida: $app (passenger | driver)" >&2; exit 1 ;;
  esac
done
