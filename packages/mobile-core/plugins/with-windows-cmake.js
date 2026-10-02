// Config plugin de Expo: en Windows, apunta Gradle a un CMake con ninja >= 1.12.
//
// El CMake 3.22.1 que AGP usa por defecto trae un ninja que no soporta rutas de más de
// 260 caracteres, y las compilaciones release de react-native-gesture-handler (dependencia
// de expo-router) generan rutas de ~350. Ninja 1.12 sí las soporta si Windows tiene
// LongPathsEnabled=1.
//
// Usa RIDEAPP_CMAKE_DIR si está definida; si no, %ANDROID_HOME%\cmake\3.31.6 si existe.
// En otros sistemas, o si no encuentra el CMake, no hace nada.
const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod } = require('expo/config-plugins');

const DEFAULT_VERSION = '3.31.6';

function findCmakeDir() {
  if (process.env.RIDEAPP_CMAKE_DIR) return process.env.RIDEAPP_CMAKE_DIR;
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk) return null;
  const dir = path.join(sdk, 'cmake', DEFAULT_VERSION);
  return fs.existsSync(path.join(dir, 'bin', 'cmake.exe')) ? dir : null;
}

module.exports = function withWindowsCmake(config) {
  if (process.platform !== 'win32') return config;
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const cmakeDir = findCmakeDir();
      if (!cmakeDir) return cfg;
      const file = path.join(cfg.modRequest.platformProjectRoot, 'local.properties');
      const lines = fs.existsSync(file)
        ? fs
            .readFileSync(file, 'utf8')
            .split(/\r?\n/)
            .filter((l) => !l.startsWith('cmake.dir='))
        : [];
      // local.properties es un archivo .properties: las barras normales evitan escapar "\".
      lines.push(`cmake.dir=${cmakeDir.replace(/\\/g, '/')}`);
      fs.writeFileSync(file, lines.filter(Boolean).join('\n') + '\n');
      return cfg;
    },
  ]);
};
