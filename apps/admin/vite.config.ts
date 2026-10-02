import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      // En desarrollo, /api va al mock-server (4000) o al API real (3000), como Traefik en producción (11.2).
      proxy: {
        '/api': { target: env.DEV_API_TARGET ?? 'http://127.0.0.1:4000', changeOrigin: true },
      },
    },
    build: { sourcemap: false },
    test: {
      environment: 'jsdom',
      include: ['test/**/*.test.{ts,tsx}'],
    },
  };
});
