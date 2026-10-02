import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC en lugar de oxc/esbuild: Nest necesita `emitDecoratorMetadata` para la inyección de dependencias.
export default defineConfig({
  oxc: false,
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.test.ts'],
    env: { NODE_ENV: 'test' },
  },
});
