import base from '@rideapp/config/eslint';

export default [
  // var/: archivos subidos y scripts locales de desarrollo (fuera de Git).
  { ignores: ['src/generated/**', 'var/**'] },
  ...base,
  {
    // Nest inyecta dependencias leyendo los tipos de los constructores en tiempo de ejecución:
    // convertirlos en `import type` rompe la inyección.
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },
];
