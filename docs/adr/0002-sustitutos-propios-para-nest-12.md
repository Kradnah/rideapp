# ADR 0002 — Validación Zod y almacenamiento del throttler propios (NestJS 12)

- **Fecha:** 2026-10-01
- **Estado:** aceptada (revisar cuando las librerías soporten Nest 12)

## Contexto

El plan (1, 7.5) prevé `nestjs-zod` 5 para validar con Zod y un almacenamiento Redis para `@nestjs/throttler`. En octubre de 2026:

- `nestjs-zod` 5.5 declara `@nestjs/common ^10 || ^11` (no 12).
- `@nest-lab/throttler-storage-redis` 1.2 declara `@nestjs/core ^7…^11` (no 12).
- NestJS 12 es **solo ESM**.

## Decisión

- `createZodDto(schema)` + `ZodValidationPipe` global (`apps/api/src/common/zod/`), unas 40 líneas. Los esquemas de petición de `contracts` son `strictObject`, así que los campos desconocidos se rechazan.
- `RedisThrottlerStorage` (`apps/api/src/infra/throttler/`): ventana fija atómica con un script Lua, compatible con `blockDuration`. Claves `rl:*`, como indica el plan.
- `/health/live` y `/health/ready` con un controlador propio en lugar de `@nestjs/terminus`, para que respondan exactamente con el contrato `HealthResponse`.
- El API es ESM (`"type": "module"`, `NodeNext`).

## Consecuencias

- Swagger (`/docs`) todavía no muestra los esquemas Zod. Pendiente: generar el OpenAPI con `z.toJSONSchema` o volver a `nestjs-zod` cuando soporte Nest 12.
- El script Lua tiene tests contra Redis real (`REDIS_TEST_URL`), que se omiten si no hay Redis.
- Los tests de Vitest compilan con SWC (`unplugin-swc`), porque oxc/esbuild no emiten `emitDecoratorMetadata` y sin eso Nest no puede inyectar dependencias.
