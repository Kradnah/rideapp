# api

API NestJS 12 (Fastify, ESM). Ver secciones 7.5 y 8 del plan.

```bash
cp apps/api/.env.example apps/api/.env      # las contraseñas deben coincidir con infra/.env
pnpm infra:up
pnpm --filter @rideapp/api db:migrate        # primera vez
pnpm --filter @rideapp/api dev               # http://127.0.0.1:3000/api  ·  Swagger: /docs
```

| Ruta                    | Qué hace                                      |
| ----------------------- | --------------------------------------------- |
| `GET /api/health/live`  | El proceso responde (no toca dependencias)    |
| `GET /api/health/ready` | Postgres y Redis responden; 503 si alguno cae |

## Estructura

```
src/
├── config/          Variables de entorno validadas con Zod
├── common/          Pipe Zod, filtro de errores → ApiError, logger
├── infra/           Prisma 7 (adapter pg), Redis (ioredis), throttler en Redis
├── modules/
│   ├── health/
│   └── geo/         MapsProvider + FakeMapsProvider (Google en la Fase 3)
└── generated/       Cliente Prisma (generado, no se versiona)
```

Los tests de throttler contra Redis real se activan con `REDIS_TEST_URL=redis://:<pass>@127.0.0.1:6379/15`.
