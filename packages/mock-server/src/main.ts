import { buildMockServer } from './app.js';

const port = Number(process.env['MOCK_PORT'] ?? 4000);
// 127.0.0.1 basta para el emulador de Android (10.0.2.2). Para un móvil físico: MOCK_HOST=0.0.0.0
const host = process.env['MOCK_HOST'] ?? '127.0.0.1';

const { app } = buildMockServer({ logger: true });

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void app.close().then(() => process.exit(0)));
}
