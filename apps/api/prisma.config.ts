import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// En local, carga apps/api/.env. En Dokploy las variables llegan por el entorno.
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env['DATABASE_URL'] },
});
