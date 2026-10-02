import base from '@rideapp/config/eslint';

export default [
  { ignores: ['src/generated/**'] },
  ...base,
  {
    // Nest inyecta dependencias leyendo los tipos de los constructores en tiempo de ejecución:
    // convertirlos en `import type` rompe la inyección.
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },
];
