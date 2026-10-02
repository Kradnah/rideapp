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

| `POST /api/auth/google` | idToken de Google → tokens (consentimiento al crear la cuenta) |
| `POST /api/auth/admin/login` → `/totp` | Login del panel: contraseña → código TOTP → cookie de sesión |
| `POST /api/auth/admin/refresh` · `/logout` | Con la cookie `__Host-` y la cabecera `X-CSRF-Token` |
| `GET /api/admin/overview` | Solo admin con TOTP |

## Crear un administrador

Los admins no se registran por el API (8.14). El comando pide la contraseña sin mostrarla y enseña **una sola vez** el QR para Google Authenticator o Aegis:

```bash
# Local
pnpm --filter @rideapp/api cli:create-admin -- --email ana@ejemplo.com --name "Ana Admin"
# Producción (en el VPS)
sudo docker exec -it $(sudo docker ps -q -f name=rideapp-api | head -1) node dist/cli/create-admin.js --email ana@ejemplo.com --name "Ana Admin"
```

Todas las rutas exigen `Authorization: Bearer <access token>` salvo las marcadas con `@Public()`.

## Estructura

```
src/
├── config/          Variables de entorno validadas con Zod
├── common/          Pipe Zod, filtro de errores → ApiError, logger
├── infra/           Prisma 7 (adapter pg), Redis (ioredis), throttler en Redis, almacenamiento cifrado
├── modules/
│   ├── health/
│   ├── auth/ users/ audit/ admin/
│   ├── drivers/     Perfil, vehículos, documentos y revisión (8.4); URLs firmadas
│   ├── location/    Disponibilidad y ubicación en vivo en Redis (GEO, TTL, Lua)
│   ├── realtime/    Gateway Socket.IO (8.10) y latido de conductores inactivos
│   └── geo/         MapsProvider + FakeMapsProvider (Google en la Fase 3)
└── generated/       Cliente Prisma (generado, no se versiona)
```

## Tests

- `pnpm --filter @rideapp/api test`: unitarios y de integración. Los de integración (`*.int.test.ts`) levantan Postgres/PostGIS y Redis con **Testcontainers**: necesitan Docker en marcha.
- Los del almacenamiento del throttler contra un Redis ya existente se activan con `REDIS_TEST_URL=redis://:<pass>@127.0.0.1:6379/15`.

## Lista de contraseñas comunes

`src/modules/auth/common-passwords.data.ts` sale de SecLists `Passwords/Common-Credentials/Pwdb_top-100000.txt`, filtrada a 10 caracteres o más y en minúsculas. Se comprueba en local, sin APIs externas.
