# api

API NestJS 12 (Fastify, ESM). Ver secciones 7.5 y 8 del plan.

```bash
cp apps/api/.env.example apps/api/.env      # las contraseñas deben coincidir con infra/.env
pnpm infra:up
pnpm --filter @rideapp/api db:migrate        # primera vez
pnpm --filter @rideapp/api dev               # http://127.0.0.1:3000/api  ·  Swagger: /docs
```

| Ruta                                    | Qué hace                                                               |
| --------------------------------------- | ---------------------------------------------------------------------- |
| `GET /api/health/live`                  | El proceso responde (no toca dependencias)                             |
| `GET /api/health/ready`                 | Postgres y Redis responden; 503 si alguno cae                          |
| `POST /api/auth/register`               | Email + contraseña + nombre + rol + consentimiento (Ley 1581) → tokens |
| `POST /api/auth/login`                  | Email + contraseña → tokens (error siempre genérico)                   |
| `POST /api/auth/refresh`                | Rota el refresh token; reutilizar uno viejo revoca la sesión           |
| `POST /api/auth/logout` · `/logout-all` | Cierra la sesión actual o todas                                        |
| `GET` · `PATCH /api/me`                 | Perfil propio                                                          |

Todas las rutas exigen `Authorization: Bearer <access token>` salvo las marcadas con `@Public()`.

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

## Tests

- `pnpm --filter @rideapp/api test`: unitarios y de integración. Los de integración (`*.int.test.ts`) levantan Postgres/PostGIS y Redis con **Testcontainers**: necesitan Docker en marcha.
- Los del almacenamiento del throttler contra un Redis ya existente se activan con `REDIS_TEST_URL=redis://:<pass>@127.0.0.1:6379/15`.

## Lista de contraseñas comunes

`src/modules/auth/common-passwords.data.ts` sale de SecLists `Passwords/Common-Credentials/Pwdb_top-100000.txt`, filtrada a 10 caracteres o más y en minúsculas. Se comprueba en local, sin APIs externas.
