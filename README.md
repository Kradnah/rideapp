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

## Avisos en Windows

- **Después de cualquier `pnpm --filter <x> add` o `npx expo install`, ejecuta `pnpm install` en la raíz.** Con `nodeLinker: hoisted`, pnpm 12 deja en `node_modules` solo lo que necesita el paquete filtrado y borra el resto (cientos de paquetes de las otras apps).
- No instales dependencias con Metro o Gradle en marcha: Windows bloquea archivos abiertos. Si algo queda roto, para ambos (`gradlew --stop`) y ejecuta `pnpm install --force`.
- Compila Android con JDK 17 (`JAVA_HOME`); el JDK que trae Android Studio no sirve (ver `apps/passenger/README.md`).

## Estructura

| Carpeta                         | Contenido                                            |
| ------------------------------- | ---------------------------------------------------- |
| `apps/api`                      | API NestJS                                           |
| `apps/passenger`, `apps/driver` | Apps Expo                                            |
| `apps/admin`                    | Panel web                                            |
| `packages/contracts`            | Esquemas Zod compartidos: **fuente única de verdad** |
| `packages/config`               | tsconfig y ESLint compartidos                        |
| `packages/mock-server`          | API falsa para desarrollar clientes sin backend      |
| `infra/`                        | docker-compose local, zona de servicio, despliegue   |
| `docs/adr/`                     | Decisiones de arquitectura                           |
