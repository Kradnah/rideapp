# rideapp

Demo de app de movilidad para Girardot, Ricaurte y Flandes. El plan completo está en [PLAN_DE_TRABAJO.md](PLAN_DE_TRABAJO.md).

## Requisitos

- Node.js 24 LTS (ver `.nvmrc`) y pnpm 12 (`npm i -g pnpm@12`)
- Docker Desktop (Postgres + Redis locales)

## Primeros pasos

```bash
pnpm install
cp infra/.env.example infra/.env   # y cambia las contraseñas
pnpm infra:up                      # Postgres/PostGIS + Redis en 127.0.0.1
pnpm turbo run build typecheck lint test
```

## Estructura

| Carpeta | Contenido |
|---|---|
| `apps/api` | API NestJS |
| `apps/passenger`, `apps/driver` | Apps Expo |
| `apps/admin` | Panel web |
| `packages/contracts` | Esquemas Zod compartidos: **fuente única de verdad** |
| `packages/config` | tsconfig y ESLint compartidos |
| `packages/mock-server` | API falsa para desarrollar clientes sin backend |
| `infra/` | docker-compose local, zona de servicio, despliegue |
| `docs/adr/` | Decisiones de arquitectura |
