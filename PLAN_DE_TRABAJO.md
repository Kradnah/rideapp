# Plan de trabajo: demo de app de movilidad tipo Uber

> **Nombre provisional del proyecto:** `rideapp` (cámbialo cuando tengas la marca).
> **Objetivo:** una demo funcional que se pueda enseñar al cliente y que sirva de base real para producción, sin reescribir.
> **Zona de operación:** Girardot (Cundinamarca), Ricaurte (Cundinamarca) y Flandes (Tolima), Colombia. Moneda: COP.
> **Restricción principal:** cero servicios externos de pago. Todo lo que tenga costo por uso se autoaloja (*self-hosted*) o se simula en la demo. **Única excepción: Google Maps Platform**, usado dentro de su nivel gratuito mensual, con cuotas que impiden pasarse sin querer (ver sección 12).
> **Infraestructura:** VPS propio con **Dokploy + Traefik**, compartido con otros proyectos; subdominios de `julian-lizcano.com` (el dominio del panel de Dokploy; `casazhef.com` queda solo para casazhef). Presupuesto de RAM para rideapp: **~2 GB como máximo** (ver sección 13).

---

## Índice

1. [Decisiones de stack](#1-decisiones-de-stack)
2. [Costos reales (lo gratis y lo inevitable)](#2-costos-reales-lo-gratis-y-lo-inevitable)
3. [Arquitectura general](#3-arquitectura-general)
4. [Estructura del repositorio (monorepo)](#4-estructura-del-repositorio-monorepo)
5. [Reglas para trabajar en paralelo sin conflictos](#5-reglas-para-trabajar-en-paralelo-sin-conflictos)
6. [Fases y orden de trabajo (por dónde empezar)](#6-fases-y-orden-de-trabajo-por-dónde-empezar)
7. [Fase 0 — Cimientos (paso a paso)](#7-fase-0--cimientos-paso-a-paso)
8. [Backend (NestJS): módulo por módulo](#8-backend-nestjs-módulo-por-módulo)
9. [App del pasajero (React Native): pantalla por pantalla](#9-app-del-pasajero-react-native)
10. [App del conductor (React Native): pantalla por pantalla](#10-app-del-conductor-react-native)
11. [Panel de administración (web)](#11-panel-de-administración-web)
12. [Mapas, rutas y geocodificación autoalojados](#12-mapas-rutas-y-geocodificación-autoalojados)
13. [Infraestructura y despliegue](#13-infraestructura-y-despliegue)
14. [Seguridad: checklist por sección](#14-seguridad-checklist-por-sección)
15. [Tratamiento de datos personales](#15-tratamiento-de-datos-personales)
16. [Pruebas y calidad](#16-pruebas-y-calidad)
17. [Definición de "demo terminada"](#17-definición-de-demo-terminada)
18. [Qué queda fuera de la demo (fase 2)](#18-qué-queda-fuera-de-la-demo-fase-2)

---

## 1. Decisiones de stack

| Área | Elección | Motivo |
|---|---|---|
| Lenguaje común | **TypeScript** en todo | Tipos compartidos entre backend y clientes: si cambia un contrato, se rompe la compilación, no la producción. |
| Gestor de paquetes | **pnpm workspaces** + **Turborepo** | Monorepo rápido y con caché de builds. |
| Backend | **NestJS** (adaptador Fastify) | Modular, con inyección de dependencias y guards; Fastify rinde más que Express. |
| ORM | **Prisma** + SQL crudo para PostGIS | Migraciones versionadas y tipado fuerte. Las columnas geográficas se gestionan con SQL en la migración. |
| Base de datos | **PostgreSQL 16+ con PostGIS** | Datos transaccionales (usuarios, viajes, pagos) y consultas geográficas históricas. |
| Tiempo real y caché | **Redis 7+** | Ubicación en vivo (GEO), bloqueos de emparejamiento, adaptador de Socket.IO, rate limiting y colas. |
| Colas / trabajos | **BullMQ** (sobre Redis) | Timeouts de ofertas, recibos y limpieza de datos. No hace falta otro servicio. |
| Tiempo real con clientes | **Socket.IO** + `@socket.io/redis-adapter` | Reconexión automática, salas por viaje y escalado horizontal. |
| Validación | **Zod** (esquemas en `packages/contracts`) | El mismo esquema valida en backend y en clientes. |
| Apps móviles | **React Native con Expo** (*development build*, no Expo Go) | Google Sign-In y Google Maps usan código nativo, así que hace falta un *dev build*. |
| Navegación móvil | **Expo Router** | Rutas basadas en archivos, con *deep links* incluidos. |
| Estado / datos móviles | **TanStack Query** (servidor) + **Zustand** (estado local) | Simple y probado. |
| Mapas en el móvil | **Google Maps** con `react-native-maps` (`PROVIDER_GOOGLE` en Android **y** iOS) | Los mapas nativos móviles de Google (Maps SDK for Android/iOS) no tienen costo por carga. |
| Rutas, distancia y ETA | **Google Routes API** (`computeRoutes`, SKU *Essentials*), llamada **solo desde el backend** | Datos de Google con buena calidad en la zona; 10.000 llamadas gratis al mes. |
| Búsqueda de direcciones | **Google Places API (New)**: *Autocomplete* + *Place Details* con campos mínimos, vía backend | Mejor cobertura de direcciones y lugares locales que OSM en Girardot. |
| Geocodificación inversa | **Google Geocoding API**, vía backend | Para "fijar en el mapa" y mostrar la dirección de recogida. |
| Abstracción | Interfaz `MapsProvider` en el backend | Si algún día los costos lo justifican, se puede cambiar el proveedor de rutas sin tocar las apps. |
| Inicio de sesión con Google | **Google Sign-In nativo** + verificación del *ID token* en el backend (`google-auth-library`) | Gratis. Sin Firebase Auth, Auth0 ni Clerk. |
| Tokens propios | JWT de acceso corto + *refresh token* rotativo guardado en BD | Control total, sin proveedores externos. |
| Contraseñas | **Argon2id** | Estándar actual recomendado por OWASP. |
| Notificaciones push | **Expo Notifications** (FCM/APNs por debajo) | Gratis. |
| Pagos | **Efectivo + pago simulado** en la demo, con una interfaz `PaymentProvider` | Luego se conecta Stripe o Mercado Pago (cobran comisión por transacción, sin cuota fija). |
| Archivos (documentos del conductor) | Disco local cifrado en la demo, detrás de un `StorageService`; más adelante un S3 autoalojado (Garage o SeaweedFS) | Sin costo. |
| Panel de administración | **React + Vite + TanStack Query + React Router**, mapas con `@vis.gl/react-google-maps` | Una SPA estática, simple de servir. |
| Despliegue, proxy y TLS | **Dokploy** (ya instalado) con su **Traefik** | Dokploy despliega desde Git, gestiona dominios y variables de entorno, y Traefik emite los certificados de Let's Encrypt. No se instala ningún otro proxy. |
| Observabilidad | Logs JSON con **pino**; **Prometheus + Grafana** (opcional); **GlitchTip** autoalojado para errores (compatible con el SDK de Sentry) | Todo gratis y autoalojado. |
| Repositorio y CI | **Repo Git propio en el VPS** (igual que casazhef) + comprobaciones locales con Husky en `pre-push` | Sin servicios externos. Para respaldo, un espejo privado opcional en GitHub o GitLab (13.6). |

> **¿Una app o dos?** Dos apps (pasajero y conductor) que comparten paquetes. Así los permisos son distintos (el conductor necesita ubicación en segundo plano y el pasajero no), las fichas de tienda son más claras y el código de un rol no llega al otro.


### 1.1 Versiones fijadas (septiembre de 2026)

| Herramienta | Versión | Motivo |
|---|---|---|
| Node.js | 24 LTS | LTS vigente. |
| pnpm | 12.x, con `node-linker=hoisted` en `.npmrc` | React Native y Metro necesitan `node_modules` planos dentro de un monorepo. |
| TypeScript | **6.0.x** (no la 7) | TypeScript 7 (la versión nativa en Go) todavía no ofrece la API de JavaScript que usan Nest CLI, tsup y ESLint. Se revisa cuando el ecosistema la soporte. |
| NestJS | 12.x | Versión estable actual. |
| Prisma | **7.x** (no la 8) | La 8 aún es *release candidate*. La 7 exige `prisma.config.ts` y un *driver adapter* (`@prisma/adapter-pg`); la URL de la BD ya no va en `schema.prisma`. |
| Zod | 4.x | Compatible con `nestjs-zod` 5. |
| Expo SDK | 57 | SDK estable actual. |

Las versiones exactas quedan en `pnpm-lock.yaml`. Las actualizaciones se revisan con `pnpm outdated` una vez al mes, pero **los cambios de versión mayor se hacen en un PR aparte**, nunca junto con una funcionalidad.

---

## 2. Costos reales (lo gratis y lo inevitable)

| Concepto | Costo | Nota |
|---|---|---|
| Todo el software del stack | 0 | Open source. |
| Google Sign-In (OAuth) | 0 | No requiere cuenta de facturación. |
| Google Maps Platform | 0 USD en la demo y al inicio | Requiere cuenta de facturación con tarjeta, pero con las cuotas configuradas (sección 12.4) **no se puede pasar del nivel gratuito**. Estimado: ~3.000 viajes al mes gratis; después, ~0,02–0,03 USD por viaje. |
| Servidor | 0 adicional | Ya tienes el VPS (8 núcleos, 23 GB de RAM y ~20 GB libres al 23-09-2026). Rideapp se limita a ~2 GB. |
| Dominio | 0 adicional | Se usan subdominios de tu dominio actual. |
| Google Play Console | 25 USD, pago único | Solo al publicar. Para la demo sirve instalar el APK directamente. |
| Apple Developer Program | 99 USD/año | **Inevitable para iOS**: sin él no hay push ni TestFlight. Si no lo tienes aún, haz la demo solo en Android. |
| EAS Build (Expo) | 0 | El plan gratuito tiene builds limitados; también puedes compilar en local (`npx expo run:android`) sin límite. |
| Pasarela de pagos | % por transacción | Solo cuando haya cobros reales. |

---

## 3. Arquitectura general

```
                ┌───────────────────┐        ┌───────────────────┐        ┌──────────────────┐
                │  App Pasajero     │        │  App Conductor    │        │  Panel Admin     │
                │  (React Native)   │        │  (React Native)   │        │  (React + Vite)  │
                └────────┬──────────┘        └────────┬──────────┘        └────────┬─────────┘
                         │ HTTPS (REST) + WSS (Socket.IO)                          │ HTTPS (cookies)
                         └───────────────┬───────────────────────────────────────┘
                                         ▼
                                ┌──────────────────┐
                                │ Proxy (TLS, RP)  │  ← el del VPS; rate limit básico, cabeceras de seguridad
                                └────────┬─────────┘
                                         ▼
                     ┌───────────────────────────────────────────┐
                     │   API NestJS (N instancias, sin estado)   │
                     │  auth · users · drivers · trips · matching│
                     │  location · pricing · geo · payments ·    │
                     │  ratings · notifications · admin · audit  │
                     │  + Gateway Socket.IO                      │
                     └───┬───────────┬───────────┬───────────┬───┘
                         │           │           │           │
                ┌────────▼───┐  ┌────▼─────┐ ┌───▼──────┐ ┌──▼─────────────────────┐
                │ PostgreSQL │  │  Redis   │ │ Workers  │ │ (externo, clave de     │
                │ + PostGIS  │  │ GEO, pub/│ │ BullMQ   │ │ Google Maps Platform   │
                │ (verdad)   │  │ sub, lock│ │          │ │ Routes·Places·Geocoding│
                └────────────┘  └──────────┘ └──────────┘ └────────────────────────┘
```

**Principios:**

- **Monolito modular.** Un solo despliegue del backend con módulos bien separados. Cada módulo expone un *service* público; ningún módulo toca las tablas de otro. Así, si algún día hace falta, se extrae como microservicio sin reescribirlo.
- **API sin estado.** Nada en memoria del proceso: sesiones, sockets y bloqueos viven en Redis, así que puedes levantar N réplicas detrás del proxy.
- **Postgres es la fuente de verdad; Redis guarda el estado efímero.** La ubicación en vivo de los conductores solo vive en Redis. En Postgres se guarda la traza del viaje, ya muestreada.
- **El servidor decide todo lo que importa**: el precio, el estado del viaje y qué conductor se asigna. El cliente solo solicita.
- **Las APIs de Google con costo se llaman solo desde el backend.** Las apps solo cargan el mapa (gratis). Así la clave de servidor nunca sale del VPS, se puede limitar el uso por usuario y se controla cuántas llamadas se hacen por viaje.

---

## 4. Estructura del repositorio (monorepo)

```
rideapp/
├── apps/
│   ├── api/                  # NestJS (REST + WebSocket + workers) + Dockerfile
│   ├── passenger/            # Expo app pasajero
│   ├── driver/               # Expo app conductor
│   └── admin/                # React + Vite + Dockerfile + nginx.conf
├── packages/
│   ├── contracts/            # ⭐ Esquemas Zod, DTOs, eventos socket, enums de estado. Fuente única de verdad.
│   ├── api-client/           # Cliente HTTP + socket tipado (usa contracts). Lo consumen las 3 apps.
│   ├── mobile-core/          # Auth storage, hooks de sesión, mapa base, theming, i18n (compartido por passenger/driver)
│   ├── ui/                   # Componentes RN compartidos (botones, inputs, sheets)
│   ├── config/               # tsconfig, eslint, prettier compartidos
│   └── mock-server/          # Servidor falso (REST + socket) basado en contracts para desarrollar clientes sin backend
├── infra/
│   ├── docker-compose.yml        # Desarrollo local: postgres + redis (+ mailpit)
│   ├── dokploy/post-receive      # Copia versionada del hook de despliegue (13.5 E)
│   ├── geo/service-area.geojson  # Polígono Girardot + Ricaurte + Flandes
│   └── backups/
├── docs/
│   ├── adr/                  # Architecture Decision Records (1 archivo por decisión)
│   ├── api.md                # Enlace al OpenAPI generado
│   └── security.md
├── .husky/                   # pre-commit y pre-push (7.8)
├── PLAN_DE_TRABAJO.md
├── pnpm-workspace.yaml
└── turbo.json
```

---

## 5. Reglas para trabajar en paralelo sin conflictos

### 5.1 Contratos primero (*contract-first*)

1. Cualquier endpoint o evento nuevo **se define primero en `packages/contracts`**, con su esquema Zod, en un PR pequeño que revisan backend y cliente.
2. Una vez aprobado el contrato:
   - el backend lo implementa;
   - los clientes trabajan contra `packages/mock-server`, que responde con datos falsos válidos según el contrato.
3. Cuando el backend termina, los clientes cambian `API_URL` del mock al backend real. No hay que tocar código.

### 5.2 Propiedad de código

- Si se suma más gente, cada carpeta tiene un responsable (`apps/api/src/modules/trips/*` → responsable de viajes, etc.). Con un repo Git en el VPS no hay PRs; si el equipo crece, conviene pasar a un Gitea autoalojado (hay plantilla en Dokploy) o a GitHub, que sí los tienen.
- **Nadie modifica el módulo de otro sin su revisión.** Un módulo usa a otro **solo** a través de su *service* exportado, nunca de su repositorio ni de sus tablas.

### 5.3 Git

- Flujo *trunk-based*: `main` siempre desplegable, ramas cortas (`feat/trips-request`, `fix/auth-refresh`) de 1 a 3 días como máximo.
- Commits con **Conventional Commits** (`feat(trips): ...`).
- Trabajando solo: cada rama se fusiona a `main` en local (`git merge --squash`) **después** de pasar las comprobaciones (7.8). **Un push a `main` despliega en la demo** (13.5), así que `main` solo recibe código probado.
- *Feature flags* sencillas (variables de entorno o una tabla `feature_flags`) para integrar a `main` funcionalidades aún incompletas.

### 5.4 Migraciones de base de datos (el conflicto más común)

- **Una migración por PR**, con nombre descriptivo.
- **Nunca se edita una migración ya fusionada**; se crea una nueva.
- Antes de fusionar: `git rebase main` y regenerar la migración si otra entró antes.
- Cambios destructivos en dos pasos: 1) agregar la columna nueva y escribir en ambas; 2) en un PR posterior, eliminar la antigua.

### 5.5 Versionado de eventos en tiempo real

- Los nombres de evento llevan dominio y versión: `trip.status.v1`, `driver.location.v1`.
- Un cambio incompatible crea `v2`; el servidor emite ambas versiones durante una transición.
- Las apps envían `X-App-Version` y el backend puede responder `426 Upgrade Required` si la versión ya no es compatible.

---

## 6. Fases y orden de trabajo (por dónde empezar)

**Empieza por la Fase 0.** Hasta que exista el monorepo, los contratos base, `docker compose up` y la CI, nadie puede trabajar en paralelo sin pisarse.

| Fase | Contenido | Backend | Pasajero | Conductor | Admin | Infra | Duración orientativa* |
|---|---|---|---|---|---|---|---|
| **0** | Cimientos | Esqueleto NestJS, config, salud | Esqueleto Expo, dev build | Esqueleto Expo, dev build | Esqueleto Vite | Monorepo, compose, CI, mapas locales | 1 semana |
| **1** | Identidad | Auth email + Google, refresh, perfil | Login, registro, perfil | Login, registro, onboarding | Login admin + TOTP | Secrets, HTTPS de staging | 1–1,5 semanas |
| **2** | Conductores y mapa | Vehículos, aprobación, disponibilidad, ubicación → Redis | Mapa base con autos cercanos | Online/offline, envío de GPS | Aprobar conductores | Proyecto de Google Maps con cuotas y claves restringidas | 1 semana |
| **3** | Solicitar viaje | Geo proxy, cotización, crear viaje, emparejamiento | Buscar destino, ver precio, pedir | Recibir oferta, aceptar o rechazar | Listado de viajes | Workers de BullMQ | 1,5 semanas |
| **4** | Viaje en vivo | Máquina de estados, sala socket, traza | Seguir al conductor, estados | Navegación, llegué/iniciar/finalizar | Viaje en vivo en el mapa | Adaptador Redis de Socket.IO | 1 semana |
| **5** | Cierre del viaje | Pago (efectivo/simulado), calificaciones, recibo, push | Pago, calificar, historial | Ganancias, calificar | Tarifas, usuarios, auditoría | Backups | 1 semana |
| **6** | Endurecimiento | Revisión de seguridad, carga, retención de datos | Pulido, errores, sin red | Pulido, batería | Informes básicos | Despliegue al VPS, monitoreo | 1 semana |

\* Estimación orientativa para 2–4 personas. Con una sola persona, multiplica por 2,5–3.

**Dependencias clave:**

```
Fase 0 ─► contracts de Auth ─► Fase 1 (los 4 frentes en paralelo con el mock)
Fase 1 ─► Fase 2 (necesita usuarios con rol de conductor)
Fase 2 ─► Fase 3 (el emparejamiento necesita conductores en Redis)
Fase 3 ─► Fase 4 ─► Fase 5
Fase 6 puede empezar parcialmente desde la Fase 3 (despliegue a staging)
```

---

## 7. Fase 0 — Cimientos (paso a paso)

### 7.1 Monorepo (lo hace una persona, el primer día)

1. `pnpm init`, `pnpm-workspace.yaml` con `apps/*` y `packages/*`, y `.npmrc` con `node-linker=hoisted`.
2. Instalar Turborepo y definir las tareas `build`, `dev`, `lint`, `typecheck` y `test` en `turbo.json`.
3. Crear `packages/config` con `tsconfig.base.json` (`strict: true`, `noUncheckedIndexedAccess: true`), ESLint y Prettier compartidos.
4. Husky + lint-staged: lint y formateo en el pre-commit; commitlint para Conventional Commits.
5. `.editorconfig`, `.nvmrc` con Node LTS y un `.gitignore` que incluya `.env*` excepto `.env.example`.

### 7.2 `packages/contracts` (base)

1. Enums: `UserRole` (`PASSENGER`, `DRIVER`, `ADMIN`), `TripStatus`, `DriverStatus`, `PaymentMethod`.
2. Esquemas Zod comunes: `LatLng` (con rangos válidos: lat entre -90 y 90, lng entre -180 y 180), `Money` (entero en **centavos** + moneda ISO, **nunca float**), `Paginated<T>` y `ApiError` (`{ code, message, details? }`).
3. Contratos de Auth (necesarios para la Fase 1): `RegisterRequest`, `LoginRequest`, `GoogleLoginRequest` (`{ idToken }`), `TokenPair` y `RefreshRequest`.
4. Mapa de eventos socket, tipado como `ServerToClientEvents` / `ClientToServerEvents`.
5. Exportar tipos inferidos (`z.infer`).

### 7.3 `packages/mock-server`

1. Servidor Fastify + Socket.IO mínimo que importa `contracts`.
2. Por cada contrato, una respuesta falsa válida (se puede generar con `@anatine/zod-mock` o a mano).
3. Un simulador de conductor falso que se mueve por una ruta fija emitiendo `driver.location.v1`. Sirve para desarrollar la app del pasajero desde el día uno.

### 7.4 Infra local: `infra/docker-compose.yml`

Servicios:

- `postgres` (imagen `postgis/postgis`, **la misma versión mayor que en producción**), con volumen y usuario **no superusuario** para la app.
- `redis`, con `requirepass` incluso en local para acostumbrarse.
- (Opcional) `mailpit` para ver los correos en desarrollo.
- Todos los puertos se publican **solo en `127.0.0.1`**.

**El entorno de desarrollo va en la máquina de cada desarrollador, no en el VPS.** El VPS es producción de otros proyectos: no tiene Android SDK para compilar las apps, y el usuario `admin` no pertenece al grupo `docker` (añadirlo equivale a darle acceso de root). Allí solo se despliega a través de Dokploy.

Mapas en local:

1. En desarrollo, el backend usa `MAPS_PROVIDER=fake` por defecto: devuelve rutas en línea recta con distancia × 1,3, y direcciones de una lista fija de lugares de Girardot. **Así el desarrollo diario y los tests no gastan cuota de Google.**
2. Con `MAPS_PROVIDER=google` usa la clave de servidor de desarrollo, que tiene cuotas diarias más bajas (ver 12.4).
3. `infra/geo/service-area.geojson`: polígono de la zona de servicio. Para la demo basta un rectángulo aproximado (lat 4.22 → 4.36, lng -74.88 → -74.70) que cubre Girardot, Ricaurte y Flandes; después se ajusta al límite real de los cascos urbanos.

### 7.5 Esqueleto del backend (`apps/api`)

1. `nest new` → cambiar a `@nestjs/platform-fastify`.
2. `ConfigModule` que **valide las variables de entorno con Zod al arrancar**: si falta un secreto, la app no arranca.
3. Prisma: `schema.prisma` inicial y primera migración con `CREATE EXTENSION postgis;`.
4. Endpoints `GET /health/live` y `GET /health/ready` (este último comprueba Postgres y Redis) con `@nestjs/terminus`.
5. Logger `nestjs-pino` con **redacción de campos sensibles** (`authorization`, `password`, `idToken`, `refreshToken`, `lat`, `lng`, `phone`, `email`).
6. `ValidationPipe` global basado en Zod (`nestjs-zod`) que rechaza campos desconocidos.
7. Filtro global de excepciones que devuelve siempre `ApiError` y **nunca trazas de error** en producción.
8. `@fastify/helmet`, CORS con lista blanca y `@nestjs/throttler` con almacenamiento en Redis.
9. Swagger/OpenAPI generado en `/docs` (solo fuera de producción).
10. `Dockerfile` multi-etapa con usuario no-root e imagen `node:lts-alpine` o *distroless*.

### 7.6 Esqueletos móviles (`apps/passenger`, `apps/driver`)

1. `npx create-expo-app` con la plantilla de TypeScript y Expo Router.
2. Instalar `expo-dev-client` y generar el *dev build* (`npx expo run:android`), necesario para los módulos nativos.
3. Configurar `app.config.ts` con **identificadores distintos**: `com.norta.rideapp.passenger` y `com.norta.rideapp.driver`.
4. Variables públicas con `EXPO_PUBLIC_API_URL`. **Nunca pongas secretos en la app**: todo lo que va en el bundle es público.
5. Instalar `react-native-maps` con su *config plugin* de Expo, pasar la clave de Maps SDK en `app.config.ts` **desde una variable de entorno de build** (no escrita en el código) y mostrar un mapa centrado en Girardot (4.3035, -74.8036) con `PROVIDER_GOOGLE`.
6. Conectar `packages/api-client` apuntando al mock-server.

### 7.7 Esqueleto del admin (`apps/admin`)

1. `pnpm create vite` con React y TypeScript.
2. React Router, TanStack Query, `api-client` y `@vis.gl/react-google-maps` (Maps JavaScript API).

### 7.8 Comprobaciones automáticas (CI local)

Como el repositorio vive en el VPS y no en GitHub, las comprobaciones corren en tu PC con Husky:

- **`pre-commit`**: lint-staged (formato y lint de los archivos cambiados) + **gitleaks** `protect --staged` (bloquea claves `AIza...`, contraseñas, etc.).
- **`pre-push`**: `pnpm install --frozen-lockfile` → `pnpm turbo run lint typecheck test` → `pnpm audit --prod --audit-level high`.
- Semanal o antes de cada demo: construir las imágenes en local (`docker build -f apps/api/Dockerfile .`) y escanearlas con **Trivy**.
- Además, Dokploy hace de última barrera: si el `build` falla dentro del Dockerfile, no reemplaza el contenedor que está funcionando.

**Criterio de salida de la Fase 0:** `pnpm dev` levanta el API, el mock-server, el admin y una app en el emulador mostrando el mapa; los hooks de Husky pasan; y el primer despliegue en Dokploy responde en `https://rideapp-api.julian-lizcano.com/api/health/ready`.

---

## 8. Backend (NestJS): módulo por módulo

### 8.0 Modelo de datos (resumen)

```
users                (id uuid, email citext unique null, email_verified, password_hash null,
                      full_name, phone null, role, status[active|suspended|deleted],
                      created_at, updated_at, deleted_at)
auth_identities      (id, user_id, provider['google'|'apple'|'password'], provider_subject,
                      UNIQUE(provider, provider_subject))
refresh_tokens       (id, user_id, family_id, token_hash, device_id, user_agent,
                      expires_at, revoked_at, replaced_by)
driver_profiles      (user_id PK, status[pending|approved|rejected|suspended], license_number_enc,
                      approved_by, approved_at, rating_avg, rating_count)
vehicles             (id, driver_id, plate, brand, model, color, year, category, active)
driver_documents     (id, driver_id, type, storage_key, mime, sha256, status, reviewed_by)
fare_rules           (id, category, base_cents, per_km_cents, per_min_cents, min_fare_cents,
                      currency, valid_from, valid_to)
fare_quotes          (id, passenger_id, origin geography(Point), destination geography(Point),
                      distance_m, duration_s, amount_cents, currency, polyline, expires_at)
trips                (id, passenger_id, driver_id null, vehicle_id null, quote_id, status,
                      origin, destination, origin_address, destination_address, destination_place_id,
                      requested_at, accepted_at, arrived_at, started_at, completed_at,
                      cancelled_at, cancelled_by, cancel_reason,
                      final_amount_cents, currency, payment_method)
trip_events          (id, trip_id, from_status, to_status, actor_id, at, meta jsonb)   # auditoría del viaje
trip_route_points    (trip_id, at, point geography(Point))   # traza muestreada (p. ej. 1 punto / 10 s)
payments             (id, trip_id, provider, provider_ref, amount_cents, status, created_at)
ratings              (id, trip_id, from_user, to_user, score 1..5, comment, UNIQUE(trip_id, from_user))
push_tokens          (id, user_id, token, platform, created_at)
audit_logs           (id, actor_id, action, entity, entity_id, ip, at, meta jsonb)
consents             (id, user_id, policy_version, accepted_at, ip, channel)   # prueba de autorización (Ley 1581)
```

Índices mínimos: `trips(passenger_id, requested_at desc)`, `trips(driver_id, requested_at desc)`, `trips(status)` e índices GiST en las columnas `geography`.

**Claves en Redis:**

| Clave | Tipo | Uso | TTL |
|---|---|---|---|
| `geo:drivers:available:{category}` | GEO | Conductores libres y su posición | Se limpia con el latido |
| `driver:{id}:state` | HASH | `status`, `tripId`, `lastSeen`, `heading`, `speed` | 60 s (se renueva con cada envío de ubicación) |
| `trip:{id}:lock` | STRING (`SET NX PX`) | Evitar que dos conductores acepten el mismo viaje | 15 s |
| `trip:{id}:offer` | HASH | Conductor al que se le ofreció y hasta cuándo | 20 s |
| `trip:{id}:rejected` | SET | Conductores que rechazaron o dejaron expirar la oferta | Duración de la búsqueda |
| `google:idtoken:{sha256}` | STRING | Anti-replay del ID token de Google | Hasta el `exp` del token |
| `rl:*` | — | Rate limiting | Según ventana |
| `cache:geo:*` | STRING | Caché de resultados de Google (`place_id` → coordenadas, geocodificación inversa) | **30 días como máximo** para coordenadas (términos de Google); `place_id` sin límite |
| `quota:maps:{userId}:{día}` | STRING (INCR) | Límite de llamadas a Google por usuario y día | 24 h |

### 8.1 `common` / `core`

1. `AuthGuard` (JWT) global; decorador `@Public()` para excepciones.
2. `RolesGuard` + `@Roles('DRIVER')`.
3. **Guard de propiedad**: helpers como `assertTripParticipant(user, trip)`. **Todos** los endpoints con `:id` comprueban que el recurso pertenece al usuario, para evitar IDOR.
4. Interceptor de `requestId` (cabecera `X-Request-Id`) propagado a logs y sockets.
5. `PrismaService` con *middleware* de *soft delete*.
6. `RedisService` (ioredis), con clientes separados para comandos y para pub/sub.
7. `ClockService` inyectable para poder probar timeouts.

### 8.2 `auth`

**Endpoints:**

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/auth/register` | Email + contraseña + nombre + rol (`PASSENGER`/`DRIVER`; **nunca `ADMIN`**) |
| POST | `/auth/login` | Email + contraseña |
| POST | `/auth/google` | `{ idToken, role? }` |
| POST | `/auth/refresh` | Rota el refresh token |
| POST | `/auth/logout` | Revoca el refresh token actual |
| POST | `/auth/logout-all` | Revoca todas las sesiones |
| POST | `/auth/password/forgot` y `/auth/password/reset` | Recuperación de contraseña por correo (SMTP propio) |
| POST | `/auth/admin/login` + `/auth/admin/totp` | Login del panel en dos pasos |

**Paso a paso:**

1. **Hash de contraseñas** con `argon2` (argon2id, `memoryCost` ≥ 19 MiB, `timeCost` ≥ 2). Contraseña de 10 caracteres como mínimo; comprobar contra una lista local de contraseñas comunes (por ejemplo, un top 100k descargado, **sin llamar a APIs externas**).
2. **Tokens de acceso**: JWT firmado con **ES256** (par de claves; la privada solo en el servidor), con `kid` en la cabecera para poder rotar claves. Contenido mínimo: `sub`, `role`, `sid` (id de sesión), `iat`, `exp`. **Duración de 10–15 minutos.** No metas email ni nombre en el token.
3. **Refresh tokens**: valor aleatorio de 256 bits (`crypto.randomBytes(32)`), guardado en BD **solo como hash SHA-256**, con 30 días de vigencia y rotación en cada uso.
   - **Detección de reutilización:** si llega un refresh token ya rotado, se revoca **toda su familia** (`family_id`), porque indica robo.
4. **Mensajes de error genéricos** en el login ("credenciales inválidas") y tiempos de respuesta constantes para no revelar si un email existe.
5. **Rate limiting** estricto en `/auth/*`: por ejemplo, 5 intentos por minuto por IP y por email, con bloqueo progresivo.
6. **Verificación de email** para las cuentas con contraseña (token de un solo uso, hash en BD, vigencia de 24 h). En la demo se puede usar Mailpit y, en producción, un SMTP propio o el de tu dominio.

#### Inicio de sesión con Google (sin servicios de pago)

**Qué necesitas (todo gratis):**

1. En **Google Cloud Console** crea un proyecto (no requiere facturación) y configura la **pantalla de consentimiento OAuth** con los scopes `openid`, `email` y `profile`, que son los únicos necesarios.
2. Crea tres **OAuth Client IDs**:
   - **Web**: su ID se usa como `webClientId` en la app y como `audience` en el backend. No hace falta su *secret*.
   - **Android**: nombre del paquete + huella **SHA-1** del certificado de firma. Registra la de *debug*, la de *release* y la de **Play App Signing** si publicas en Play.
   - **iOS**: *bundle id*.
   - Necesitas un juego de clientes Android/iOS **por cada app** (pasajero y conductor).

**Flujo:**

```
App (botón Google)
  └─► @react-native-google-signin/google-signin → GoogleSignin.signIn()
        └─► obtiene idToken (JWT firmado por Google)
  └─► POST /auth/google { idToken, role }
Backend
  1. google-auth-library: client.verifyIdToken({ idToken, audience: [WEB_CLIENT_ID] })
     → valida firma (claves públicas de Google, cacheadas), exp, iss ∈ {accounts.google.com, https://accounts.google.com}, aud
  2. Rechaza si email_verified !== true
  3. Anti-replay: SET NX google:idtoken:{sha256(idToken)} con TTL hasta exp → si ya existía, rechazar
  4. Busca auth_identities WHERE provider='google' AND provider_subject = payload.sub
     ├─ existe → login de ese usuario
     └─ no existe:
          ├─ ¿existe usuario con ese email?
          │    → NO vincular automáticamente si ese usuario tiene contraseña y email NO verificado
          │      (evita toma de cuenta). Si su email está verificado, vincular y registrar en audit_logs
          │      + notificar por correo "se vinculó Google a tu cuenta".
          └─ no existe → crear usuario (email, nombre, email_verified=true) + identidad google
  5. Emite TokenPair propio (Google ya no interviene más)
```

**Reglas importantes:**

- **Identifica al usuario por `sub` (el ID de Google), nunca por el email.** El email puede cambiar; el `sub` no.
- **Nunca confíes en datos que la app envía por su cuenta** (email, nombre): solo en lo que viene **dentro del ID token verificado**.
- **No guardes el ID token** ni pidas *access tokens* de Google: no los necesitas. Pide solo `openid email profile`.
- Si un pasajero quiere ser también conductor, se crea el `driver_profile` sobre el mismo usuario. El rol no se elige en cada login.
- **Si publicas en iOS con login de Google, Apple exige ofrecer también "Sign in with Apple"** (o un login equivalente que proteja la privacidad). Es gratis dentro de la cuenta de desarrollador de Apple y se implementa igual: `expo-apple-authentication` → `identityToken` → verificación en el backend con las claves públicas de Apple (JWKS), usando `aud` = *bundle id*. Déjalo preparado en la tabla `auth_identities`.

### 8.3 `users`

1. `GET /me`, `PATCH /me` (nombre y teléfono), `DELETE /me`.
2. **Eliminación de cuenta** (obligatoria en Google Play y App Store): marca `deleted_at`, revoca sesiones, **anonimiza** los datos personales (email → `deleted+{id}@invalid`, nombre → "Usuario eliminado", teléfono → null) y conserva los viajes y pagos solo el tiempo que exija la ley (ver sección 15).
3. `GET /me/export`: exportación de los datos personales en JSON (derecho de acceso y portabilidad).
4. Registro y borrado de push tokens: `POST /me/push-tokens` y `DELETE /me/push-tokens/:token`.

### 8.4 `drivers`

1. `POST /drivers/onboarding`: crea el `driver_profile` en estado `pending`.
2. `POST /drivers/vehicles` y `GET /drivers/vehicles`.
3. `POST /drivers/documents` (subida *multipart*):
   - límite de tamaño (p. ej., 5 MB);
   - validar el tipo real por *magic bytes* (`file-type`), no por la extensión: solo JPEG, PNG o PDF;
   - **quitar los metadatos EXIF**, que pueden incluir GPS (con `sharp`);
   - nombre de archivo aleatorio (UUID); nunca usar el nombre original como ruta;
   - guardarlo **cifrado** y fuera de cualquier carpeta pública;
   - servirlo solo al admin, mediante un endpoint autenticado o una URL firmada de corta duración.
4. Estados: `pending → approved | rejected`; `approved ↔ suspended`. Solo un conductor `approved` con vehículo activo puede ponerse en línea.
5. `license_number` se cifra a nivel de columna (AES-256-GCM con clave de entorno, mediante un helper `crypto.service.ts`).

### 8.5 `location` (gateway en tiempo real)

1. El conductor emite `driver.location.v1` `{ lat, lng, heading, speed, accuracy, ts }` cada **4–5 s** en viaje y cada **10–15 s** mientras está libre.
2. El servidor:
   - valida con Zod y descarta lecturas con `accuracy` mayor de 100 m;
   - **comprueba la plausibilidad**: una velocidad implícita respecto al punto anterior de más de ~200 km/h se descarta y se marca como sospechosa (señal de GPS falso);
   - aplica rate limit por socket (p. ej., 1 mensaje por segundo como máximo);
   - si el conductor está libre, hace `GEOADD geo:drivers:available:{cat}` y renueva `driver:{id}:state`;
   - si está en viaje, reenvía la posición **solo a la sala `trip:{tripId}`** y guarda un punto cada ~10 s en `trip_route_points` (en lote, mediante BullMQ).
3. **Latido**: un job cada 30 s elimina de la capa GEO a los conductores cuyo `lastSeen` supere los 60 s.
4. `POST /drivers/me/online` y `POST /drivers/me/offline`; al desconectarse, se quita de la capa GEO.
5. **Para el pasajero, conductores cercanos** (`GET /drivers/nearby?lat&lng`): devuelve como máximo 10 posiciones **redondeadas o con ruido de ~50–100 m y sin IDs**. Nunca se exponen identidades ni posiciones exactas de conductores que no le fueron asignados.

### 8.6 `geo` (proxy hacia Google Maps Platform)

Interfaz `MapsProvider` con dos implementaciones: `GoogleMapsProvider` y `FakeMapsProvider` (desarrollo y tests). Ninguna app llama directamente a las APIs de Google con costo.

1. `GET /geo/autocomplete?q=&sessionToken=` → **Places API (New) Autocomplete**:
   - la app genera un **`sessionToken` (UUID) por búsqueda** y lo reutiliza en cada tecla hasta que el usuario elige un resultado; así Google agrupa la sesión y se cobra mucho menos;
   - *debounce* de 400 ms y mínimo 3 caracteres en la app;
   - `includedRegionCodes: ["co"]` y `locationRestriction` con el rectángulo de la zona de servicio, para que solo salgan lugares de Girardot, Ricaurte y Flandes;
   - `languageCode: "es"`.
2. `GET /geo/place/:placeId?sessionToken=` → **Place Details** con la misma `sessionToken` (cierra la sesión) y **`X-Goog-FieldMask: id,formattedAddress,location`**. Pedir campos como `displayName`, fotos o reseñas cambia el cobro a un SKU más caro.
3. `GET /geo/reverse?lat&lng` → **Geocoding API** (reverse). Antes de llamar, redondea a 4 decimales (~11 m) y busca en la caché.
4. `MapsProvider.route(origin, destination)` → **Routes API `computeRoutes`**:
   - `routingPreference: "TRAFFIC_UNAWARE"` (SKU *Essentials*; con tráfico pasa a *Pro*, más caro y con menos cupo gratis);
   - `X-Goog-FieldMask: routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline`;
   - `travelMode: "DRIVE"`.
5. **Todas las llamadas** tienen *timeout* (3 s), reintento único con *backoff*, límite por usuario (`quota:maps:*`, p. ej. 60 autocompletados y 20 rutas al día) y un contador global en Redis para las métricas.
6. Validar que origen y destino estén **dentro de la zona de servicio** (polígono en PostGIS, `ST_Contains`) **antes** de llamar a Google: una petición fuera de zona no gasta cuota.

### 8.7 `pricing`

1. `POST /trips/quote` `{ origin, destination, category }` → ruta con `MapsProvider.route` → aplicar `fare_rules` → guardar `fare_quotes` con `expires_at` = ahora + 5 min → devolver `{ quoteId, amount, currency, distance, duration, polyline }`.
2. **Todo el dinero se maneja en enteros**, en la unidad mínima de ISO 4217 (para COP, centavos, aunque en la práctica no se usen). El precio final se redondea a múltiplos de 100 COP con una única función en `packages/contracts` (`roundFare`).
3. El precio **nunca** se recibe del cliente: al crear el viaje solo se envía el `quoteId`, y el servidor comprueba que pertenezca al usuario y no haya expirado.
4. Precio final = el cotizado (modelo de precio cerrado, más simple para la demo). Más adelante, recálculo con la traza real.

### 8.8 `trips` (máquina de estados)

```
REQUESTED ──► SEARCHING ──► DRIVER_ASSIGNED ──► DRIVER_ARRIVED ──► IN_PROGRESS ──► COMPLETED
    │             │                │                   │
    │             ├─► NO_DRIVERS   │                   │
    └─────────────┴────────────────┴───────────────────┴──► CANCELLED (by PASSENGER | DRIVER | SYSTEM)
```

1. Implementa la máquina en **un único lugar** (`trip-state.machine.ts`) con una tabla de transiciones permitidas y el rol que puede ejecutar cada una.
2. Cada transición:
   - usa una transacción con `UPDATE trips SET status = :to WHERE id = :id AND status = :from` (bloqueo optimista: si afecta 0 filas, alguien ganó la carrera y se devuelve `409`);
   - inserta en `trip_events`;
   - publica el evento `trip.status.v1` a la sala del viaje.
3. **Endpoints:**
   - `POST /trips` `{ quoteId, paymentMethod }` (pasajero). Regla: **solo un viaje activo por pasajero**; una segunda solicitud devuelve `409`.
   - `POST /trips/:id/cancel` (pasajero o conductor asignado), con motivo.
   - `POST /trips/:id/arrived`, `/start` y `/complete` (solo el conductor asignado).
   - `GET /trips/:id` (solo los participantes o un admin).
   - `GET /trips?role=passenger|driver` (historial paginado del propio usuario).
   - `GET /trips/active`, para recuperar el estado tras cerrar la app o reconectar.
4. **Validaciones de seguridad y negocio:**
   - `start` solo si el conductor está a menos de ~150 m del origen (según su última ubicación en Redis);
   - `complete` solo si el viaje está `IN_PROGRESS`;
   - un PIN de 4 dígitos que el pasajero dicta al conductor para iniciar el viaje (opcional, pero muy recomendable contra fraudes).
5. **Idempotencia**: `POST /trips` y `POST /trips/:id/complete` aceptan la cabecera `Idempotency-Key` (guardada en Redis durante 24 h), para que los reintentos por mala conexión no dupliquen acciones.

### 8.9 `matching`

1. Cuando el viaje pasa a `SEARCHING`, se encola el job `matching.findDriver(tripId)`.
2. `GEOSEARCH geo:drivers:available:{cat} FROMLONLAT lng lat BYRADIUS 3 km ASC COUNT 10`.
3. Se excluyen los conductores en `trip:{id}:rejected`, los que no están `approved` y los que ya tienen un viaje.
4. Se ordenan por distancia en línea recta (la que da Redis). **No se calcula ETA con Google para cada candidato**: en una ciudad del tamaño de Girardot la diferencia es mínima y cada consulta cuesta cuota.
5. Se ofrece al **primero**: se guarda `trip:{id}:offer`, se emite `trip.offer.v1` **solo a ese conductor** y se envía un push si la app está en segundo plano.
6. Se programa un job con retraso de 15 s, `matching.offerTimeout`: si no respondió, el conductor pasa a `rejected` y se vuelve al paso 2.
7. **Aceptar** (`POST /trips/:id/accept`, solo el conductor ofertado):
   - `SET trip:{id}:lock {driverId} NX PX 15000`; si falla, devuelve `409`;
   - verifica que `trip:{id}:offer.driverId === yo` y que no expiró;
   - hace la transición `SEARCHING → DRIVER_ASSIGNED`, saca al conductor de la capa GEO y marca su estado como `busy`;
   - une al conductor y al pasajero a la sala `trip:{id}`.
8. Si se amplía el radio (3 → 5 → 8 km) y pasan 2 minutos sin conductor, el viaje pasa a `NO_DRIVERS` y se notifica al pasajero.
9. **Anti-abuso:** contar los rechazos y cancelaciones por conductor y pasajero para las métricas del admin.

### 8.10 `realtime` (gateway Socket.IO)

1. **Autenticación en el handshake**: `io(url, { auth: { token } })`. El middleware verifica el JWT y, si no es válido, desconecta. **No aceptes el token por query string**, porque acaba en los logs.
2. Al conectar, el socket se une a `user:{userId}` y, si tiene viaje activo, a `trip:{tripId}`.
3. **Nunca permitas que el cliente elija a qué sala unirse.** El servidor decide las salas según la BD.
4. Adaptador `@socket.io/redis-adapter` para funcionar con N instancias.
5. Cuando el access token expira, el cliente se reconecta con uno nuevo. El servidor comprueba periódicamente que el `sid` de la sesión siga activo; si se revocó, desconecta.
6. **Eventos (en `contracts`):**

| Evento | Dirección | Destinatario |
|---|---|---|
| `driver.location.v1` | conductor → servidor | — |
| `trip.driverLocation.v1` | servidor → cliente | sala `trip:{id}` (solo el pasajero de ese viaje) |
| `trip.offer.v1` | servidor → cliente | `user:{driverId}` |
| `trip.offerCancelled.v1` | servidor → cliente | `user:{driverId}` |
| `trip.status.v1` | servidor → cliente | sala `trip:{id}` |
| `session.revoked.v1` | servidor → cliente | `user:{id}` |

### 8.11 `payments`

1. Interfaz `PaymentProvider { authorize(), capture(), refund() }`.
2. Implementaciones de la demo: `CashProvider` (se marca como pagado cuando el conductor confirma el cobro) y `FakeCardProvider` (siempre aprueba y deja registro).
3. `payments` guarda el estado y la referencia. **Nunca se guardan números de tarjeta ni CVV** (tampoco en logs). Con la pasarela real se usará su SDK de tokenización para que los datos de la tarjeta **nunca pasen por tu servidor**, lo que reduce el alcance de PCI-DSS.
4. Webhooks de la pasarela (a futuro): verificar la firma HMAC y la marca de tiempo, y procesar de forma idempotente.

### 8.12 `ratings`

1. `POST /trips/:id/rating` `{ score, comment? }`: solo participantes, solo si el viaje está `COMPLETED`, una vez por usuario (restricción única en BD) y en un plazo de 7 días.
2. Actualización incremental de `rating_avg` y `rating_count`.
3. Comentario de 500 caracteres como máximo, guardado como texto plano y **escapado al mostrarlo en el admin** (evita XSS).

### 8.13 `notifications`

1. `NotificationsService.push(userId, template, data)` → Expo Push API (gratis) con los tokens del usuario.
2. **En el contenido del push no van datos sensibles** (nada de direcciones exactas ni teléfonos): solo "Tienes una nueva solicitud de viaje", y la app consulta el detalle al API.
3. Eliminar los tokens que Expo reporte como `DeviceNotRegistered`.
4. Correos (verificación, recuperación y recibo) por SMTP con plantillas; se envían con BullMQ.

### 8.14 `admin`

1. Endpoints bajo `/admin/*`, con `@Roles('ADMIN')` y además la comprobación de que la sesión pasó el TOTP (`amr: ['pwd','totp']` en el token).
2. Usuarios: listar, buscar y suspender o reactivar (con motivo).
3. Conductores: pendientes, ver documentos (URL firmada de 5 min) y aprobar o rechazar.
4. Viajes: listado con filtros, detalle con `trip_events` y traza en el mapa.
5. Tarifas: CRUD de `fare_rules` (nunca se edita una tarifa vigente: se crea una nueva con `valid_from`).
6. **Toda acción de un admin se registra en `audit_logs`.**
7. Los admins **no se registran**: se crean con un comando de CLI (`pnpm --filter api cli create-admin`) que genera el secreto TOTP.

### 8.15 `audit` y `jobs`

1. `AuditService.log(actor, action, entity, id, meta)`, que usan auth (logins, vinculaciones de cuenta, *logout-all*), admin y payments.
2. Jobs programados en BullMQ:
   - limpieza de conductores inactivos en GEO (cada 30 s);
   - expiración de `fare_quotes` (cada hora);
   - **retención de datos**: anonimizar o borrar las trazas GPS antiguas según la política (cada noche, ver sección 15);
   - purga de refresh tokens expirados (cada noche).

---

## 9. App del pasajero (React Native)

**Estructura sugerida (Expo Router):**

```
app/
├── (auth)/welcome.tsx, login.tsx, register.tsx, forgot.tsx
├── (main)/_layout.tsx          # requiere sesión
│   ├── index.tsx               # Mapa + "¿A dónde vas?"
│   ├── search.tsx              # Buscar destino
│   ├── confirm.tsx             # Ruta + precio + método de pago
│   ├── trip/[id].tsx           # Viaje en curso (buscando / conductor en camino / en viaje)
│   ├── trip/[id]/rate.tsx
│   ├── history/index.tsx, history/[id].tsx
│   └── profile/index.tsx, profile/privacy.tsx (exportar/eliminar cuenta)
```

### 9.1 Sesión y autenticación

1. `SessionProvider` en `packages/mobile-core`:
   - guarda el access y el refresh token en **`expo-secure-store`** (Keychain/Keystore), **nunca en AsyncStorage**;
   - el interceptor de `api-client` refresca automáticamente ante un `401`, **una sola vez y con cola** para que varias peticiones simultáneas no disparen varios refresh;
   - si el refresh falla, cierra la sesión y borra el almacenamiento seguro.
2. Pantalla de bienvenida: botones "Continuar con Google" (y "Continuar con Apple" en iOS) y "Usar email".
3. Google:
   - `GoogleSignin.configure({ webClientId, scopes: ['email','profile'] })`;
   - `const { idToken } = await GoogleSignin.signIn()` → `POST /auth/google`;
   - al cerrar sesión, llamar también a `GoogleSignin.signOut()`.
4. Registro por email: formulario con validación Zod compartida y pantalla de "verifica tu correo".
5. Bloqueo opcional con biometría (`expo-local-authentication`) al abrir la app.

### 9.2 Mapa principal

1. `MapView` con `provider={PROVIDER_GOOGLE}`, centrado en la ubicación del usuario o en Girardot. **No tapes el logo de Google** (lo exigen los términos); si pones un *bottom sheet*, usa `mapPadding` para que el logo siga visible.
2. Permiso de ubicación **solo mientras se usa la app** (el pasajero no necesita segundo plano). Explica el motivo antes de pedirlo.
3. Centrar el mapa en el usuario y consultar `GET /drivers/nearby` cada 10 s mientras la pantalla esté visible (se pausa en segundo plano).
4. Si el usuario niega el permiso, permitir elegir el origen manualmente en el mapa.

### 9.3 Buscar destino y cotizar

1. Al abrir el buscador se genera un `sessionToken` nuevo. Campo con *debounce* de 400 ms → `GET /geo/autocomplete`. Al elegir → `GET /geo/place/:placeId` con el mismo token.
2. Opción "Fijar en el mapa": pin central y `GET /geo/reverse` **solo cuando el mapa deja de moverse** (`onRegionChangeComplete` + *debounce* de 800 ms), no en cada movimiento.
3. Accesos rápidos a "Casa", "Trabajo" y los destinos recientes guardados por el usuario: evitan llamadas a Google y son más cómodos.
4. `POST /trips/quote` → mostrar la polilínea (decodificada con `@mapbox/polyline`), el precio, la duración y la distancia.
5. Mostrar cuándo expira la cotización (a los 5 min) y volver a cotizar automáticamente si expiró.

### 9.4 Pedir y seguir el viaje

1. `POST /trips` con un `Idempotency-Key` generado en el cliente (UUID).
2. Pantalla de viaje, que se pinta **siempre a partir del estado del servidor** (`trip.status.v1` + `GET /trips/:id`):
   - `SEARCHING`: animación y botón de cancelar;
   - `DRIVER_ASSIGNED`: nombre, foto, calificación, placa, color, ETA y PIN, con el marcador del conductor moviéndose e interpolado entre actualizaciones para que se vea fluido. **El ETA lo calcula el servidor sin llamar a Google en cada actualización**: calcula la ruta conductor → recogida una vez al aceptar y, con cada posición, estima el tiempo restante según la distancia que queda sobre esa polilínea. Solo vuelve a pedir la ruta a Google si el conductor se desvía más de 200 m (como máximo, una vez cada 2 minutos);
   - `DRIVER_ARRIVED`: aviso y *push*;
   - `IN_PROGRESS`: ruta y avance;
   - `COMPLETED`: ir a pago y calificación.
3. **Recuperación:** al abrir la app, `GET /trips/active` → si hay un viaje activo, navegar directamente a él. Reconexión automática del socket con el nuevo token.
4. **Seguridad del usuario:** botón "Compartir viaje" (enlace de solo lectura con token aleatorio que caduca al terminar el viaje; a futuro) y botón de emergencia que marca la **Línea 123** (número único de emergencias en Colombia).

### 9.5 Pago, calificación e historial

1. Método: efectivo o "tarjeta demo".
2. Calificación de 1 a 5 estrellas con comentario opcional.
3. Historial paginado con detalle y recibo.

### 9.6 Perfil y privacidad

1. Editar nombre y teléfono.
2. "Descargar mis datos" → `GET /me/export`.
3. "Eliminar mi cuenta", con confirmación → `DELETE /me`.
4. Enlaces a la política de privacidad y los términos.

---

## 10. App del conductor (React Native)

```
app/
├── (auth)/...                  # igual que pasajero
├── (onboarding)/profile.tsx, vehicle.tsx, documents.tsx, pending.tsx
├── (main)/index.tsx            # Mapa + toggle En línea / Fuera de línea
│   ├── offer.tsx               # Modal de oferta con cuenta regresiva
│   ├── trip/[id].tsx           # Ir a recoger → Llegué → PIN → Iniciar → Finalizar → Cobrar
│   ├── earnings.tsx            # Ganancias del día/semana
│   └── profile/...
```

### 10.1 Onboarding

1. Tras el login: si no tiene `driver_profile`, pasa por datos personales → vehículo → documentos (cámara o galería con `expo-image-picker`, comprimidos antes de subirlos) → pantalla "En revisión".
2. La app consulta el estado periódicamente o recibe un *push* cuando el admin lo aprueba.

### 10.2 En línea y ubicación en segundo plano

1. Interruptor "En línea" → `POST /drivers/me/online`.
2. **Ubicación en segundo plano** con `expo-location` + `expo-task-manager` (`startLocationUpdatesAsync`):
   - Android: *foreground service* con notificación persistente ("Estás en línea"), que es obligatoria;
   - iOS: `UIBackgroundModes: location` y textos de permiso claros;
   - Google Play exige declarar y justificar el uso de ubicación en segundo plano (formulario y vídeo). Prepara el texto con antelación.
3. Frecuencia adaptativa: cada 10–15 s si está libre y cada 4–5 s en viaje; `distanceInterval` ≥ 10 m para ahorrar batería.
4. Envío por socket; si no hay conexión, se guarda en un buffer local (solo los últimos N puntos) y se envía al reconectar.
5. **Al pasar a "Fuera de línea" se detiene por completo** la tarea de ubicación. Nunca se rastrea a un conductor desconectado.

### 10.3 Ofertas y viaje

1. `trip.offer.v1` → modal con la distancia a la recogida, la zona aproximada del destino, el precio y una cuenta regresiva de 15 s. Sonido y vibración.
2. Aceptar → `POST /trips/:id/accept` (si responde `409`, "otro conductor lo tomó").
3. Botón "Navegar" que abre la app de navegación del teléfono mediante *deep link* (`geo:` o `google.navigation:` en Android, Apple Maps o Google Maps en iOS). Gratis, sin integrar un SDK de navegación.
4. Flujo de botones: **Llegué** → **Pedir PIN al pasajero** → **Iniciar** → **Finalizar** → **Confirmar cobro** (si es en efectivo).
5. Calificar al pasajero.

### 10.4 Ganancias

1. `GET /drivers/me/earnings?from&to`: suma de los viajes completados. En la demo no hay liquidaciones reales.

---

## 11. Panel de administración (web)

### 11.1 Paso a paso

1. **Login**: email + contraseña → pantalla de TOTP (código de 6 dígitos de Google Authenticator o Aegis) → sesión.
2. **Sesión del admin con cookies**, no con `localStorage`: nombre con prefijo **`__Host-`** (obliga a `Secure`, `Path=/` y a no llevar `Domain`, así que la cookie no puede compartirse con otros subdominios ni ser sobrescrita por ellos), `HttpOnly` y `SameSite=Strict`, con **token CSRF** (patrón *double-submit*) en las peticiones que modifican datos.
3. Layout con menú: Dashboard · Conductores · Usuarios · Viajes · Tarifas · Auditoría.
4. **Dashboard:** viajes de hoy, conductores en línea y un mapa con los conductores en vivo (endpoint admin que lee la capa GEO).
5. **Conductores:** cola de pendientes → detalle → visor de documentos (URL firmada) → aprobar o rechazar con motivo.
6. **Usuarios:** búsqueda y suspensión. **Los datos sensibles se muestran enmascarados por defecto** (teléfono `+57 *** *** 1234`); revelarlos requiere un clic que queda registrado en auditoría.
7. **Viajes:** tabla con filtros, detalle con la línea de tiempo de `trip_events` y la traza en el mapa.
8. **Tarifas:** crear una nueva versión de tarifa por categoría.
9. **Auditoría:** tabla de `audit_logs` (solo lectura).

### 11.2 Seguridad específica del admin

- Servirlo en su propio subdominio (`rideapp-admin.julian-lizcano.com`) con una **Content-Security-Policy** estricta: `default-src 'self'`, sin `unsafe-inline` y con `frame-ancestors 'none'`. Añade solo los orígenes que necesita Google Maps JS (`https://maps.googleapis.com`, `https://maps.gstatic.com` y `https://*.googleapis.com` en `script-src`, `img-src`, `connect-src` y `font-src`).
- **El admin llama al API por su propio subdominio**: Traefik envía `rideapp-admin.julian-lizcano.com/api/*` a la aplicación del API (igual que casazhef hace con `casazhef.com/api`). Así la cookie de sesión queda solo en ese host y no es visible para las otras aplicaciones de tu dominio (ver 13.3 y 13.4).
- Opcional, pero muy recomendable: limitar el acceso por IP o VPN (WireGuard, gratis) con un middleware `ipAllowList` de Traefik.
- Sesión que expira tras 30 min de inactividad y a las 8 h como máximo.
- Nunca usar `dangerouslySetInnerHTML` con datos de usuarios.

---

## 12. Mapas con Google Maps Platform

> Los precios y cupos de esta sección corresponden al modelo de Google vigente desde marzo de 2025 (cupo gratis mensual por SKU en lugar del antiguo crédito de 200 USD). **Compruébalos en la página oficial de precios antes de activar la facturación**, porque Google los cambia de vez en cuando.

### 12.1 Qué API se usa y para qué

| Uso | API / SKU | Desde dónde | Cupo gratis mensual (aprox.) | Precio después (aprox.) |
|---|---|---|---|---|
| Mostrar el mapa en las apps | **Maps SDK for Android / iOS** (mapas dinámicos móviles) | App | **Ilimitado** | 0 |
| Mapa del panel de administración | Maps JavaScript API (*Dynamic Maps*, Essentials) | Navegador del admin | 10.000 cargas | ~7 USD / 1.000 |
| Autocompletar direcciones | Places API (New): *Autocomplete* con *session token* | Backend | 10.000 peticiones | ~2,83 USD / 1.000 (las sesiones que terminan en Place Details salen más baratas) |
| Coordenadas del lugar elegido | Places API (New): *Place Details Essentials* (solo `id,formattedAddress,location`) | Backend | 10.000 | ~5 USD / 1.000 |
| Dirección de un punto del mapa | Geocoding API (Essentials) | Backend | 10.000 | ~5 USD / 1.000 |
| Ruta, distancia y duración | Routes API `computeRoutes` (Essentials, sin tráfico) | Backend | 10.000 | ~5 USD / 1.000 |
| Navegación del conductor | La app de Google Maps del teléfono, abierta con *deep link* | App | Ilimitado | 0 (no usa tu cuenta) |

**No actives** las APIs *legacy* (Directions, Distance Matrix, Places antigua): Google ya no las habilita en proyectos nuevos.

### 12.2 Llamadas por viaje y cuántos viajes caben gratis

| Momento | Llamadas | SKU |
|---|---|---|
| El pasajero busca el destino | ~4–6 peticiones de autocompletado + 1 Place Details | Autocomplete + Place Details |
| Dirección de recogida (GPS → texto) | 0–1 (caché) | Geocoding |
| Cotización | 1 | Routes |
| El conductor acepta (ruta conductor → recogida) | 1 | Routes |
| Recálculos por desvío | 0–1 | Routes |
| Inicio del viaje | 0 (se reutiliza la polilínea de la cotización) | — |

- **Routes**, el SKU que se agota primero, usa ~2–3 llamadas por viaje, así que alcanza para **~3.000–5.000 viajes al mes gratis** (unos 100–150 al día).
- Pasado ese umbral, el costo marginal ronda los **0,02–0,03 USD por viaje** (~80–120 COP), muy por debajo de la comisión de cualquier viaje.
- Las cotizaciones que no terminan en viaje también gastan cupo. Por eso hay límites por usuario (8.6) y caché.

### 12.3 Reglas de los términos de Google que afectan al diseño

1. **Los resultados de Google (rutas y lugares) solo se pueden mostrar sobre un mapa de Google.** Por eso se usa `PROVIDER_GOOGLE` también en iOS (no Apple Maps) y en el admin.
2. **Caché limitada:** las coordenadas obtenidas de Google se pueden guardar **30 días como máximo**; el `place_id` se puede guardar sin límite. Por eso:
   - `cache:geo:*` en Redis expira en ≤ 30 días;
   - en `trips` se guarda el `place_id` del destino y, como coordenadas permanentes del viaje, **los puntos GPS reales** donde empezó y terminó (datos propios, que no provienen de Google).
3. **El logo y los avisos de Google deben verse siempre** en el mapa.
4. En la política de privacidad hay que mencionar que se usa Google Maps y enlazar su política.

### 12.4 Configuración de la cuenta (para que la demo sea realmente gratis)

1. En el **mismo proyecto de Google Cloud** del inicio de sesión (o en uno separado, si prefieres aislar la facturación), activa la facturación. Google pide tarjeta, pero no cobra mientras estés dentro del cupo gratis.
2. Activa **solo**: Maps SDK for Android, Maps SDK for iOS, Maps JavaScript API, Places API (New), Geocoding API y Routes API.
3. **Cuotas diarias (el tope real):** en *APIs y servicios → Cuotas*, pon límites por día a cada API. Por ejemplo, para la demo:
   - Routes API: 300 por día (≈ 9.000 al mes, por debajo del cupo de 10.000);
   - Places Autocomplete: 300 por día;
   - Place Details: 300 por día;
   - Geocoding: 300 por día.
   Al llegar al límite, Google devuelve error en lugar de cobrar. El backend lo detecta (`429` / `RESOURCE_EXHAUSTED`), cambia temporalmente al `FakeMapsProvider` para las rutas (línea recta × 1,3) y avisa por log o correo.
4. **Alertas de presupuesto:** crea un presupuesto de 1 USD con alertas al 50 %, 90 % y 100 %. Ojo: **las alertas avisan, pero no detienen los cobros**; lo que realmente los detiene son las cuotas del paso 3.
5. Cuando haya usuarios, sube las cuotas poco a poco según las métricas del contador global en Redis.

### 12.5 Claves de API (una por uso, cada una restringida)

| Clave | Restricción de aplicación | Restricción de API | Dónde vive |
|---|---|---|---|
| `maps-android-passenger` / `maps-android-driver` | Apps Android: paquete + SHA-1 (debug, release y Play App Signing) | Solo Maps SDK for Android | Se inyecta al compilar desde una variable de entorno (EAS Secrets o `.env` local fuera de Git). Termina dentro del APK, **por eso la restricción es obligatoria**. |
| `maps-ios-passenger` / `maps-ios-driver` | Apps iOS: *bundle id* | Solo Maps SDK for iOS | Igual que la anterior |
| `maps-web-admin` | Referentes HTTP: `https://rideapp-admin.julian-lizcano.com/*` | Solo Maps JavaScript API | Build del admin |
| `maps-server` | **Dirección IP del VPS** | Solo Places API (New), Geocoding y Routes | `.env` del servidor (permisos `600`). **Nunca en una app ni en el repositorio.** |
| `maps-server-dev` | IP de desarrollo (o ninguna) | Las mismas, con cuotas más bajas | `.env` local de cada desarrollador |

### 12.6 Salida futura si los costos crecen

Gracias a la interfaz `MapsProvider`, más adelante se puede mover el cálculo de rutas a un OSRM autoalojado con el mapa de OSM de la zona (Girardot cabe en muy poca RAM). Eso sí: por los términos de Google, si cambias las rutas también tendrías que cambiar el mapa a MapLibre/OSM. No es necesario planearlo ahora.

---

## 13. Infraestructura y despliegue

### 13.1 Estado actual del VPS (revisado el 23-09-2026)

| Aspecto | Estado | Implicación |
|---|---|---|
| CPU y RAM | 8 núcleos, 23 GB en total, ~20 GB disponibles | Hay margen de sobra; aun así, rideapp se limita a ~2 GB (13.5, paso C). |
| Swap | **No hay** | Si algún contenedor sin límite se dispara, el kernel puede matar procesos de **cualquier** proyecto. Recomendado: un *swapfile* de 4 GB (13.7). |
| Disco | 290 GB, 6 % usado | Sin problema. |
| Proxy | Traefik gestionado por Dokploy en 80/443, con Let's Encrypt (HTTP challenge) | Los dominios se configuran desde Dokploy, no a mano. |
| Dashboard de Traefik | `api.insecure: true`, pero el puerto 8080 **no** está publicado en el host | Correcto: **no publiques nunca el 8080**. |
| Panel de Dokploy | Público en `https://dokploy.julian-lizcano.com` | Controla todo el servidor: **2FA obligatorio** y contraseña larga y única. |
| Repositorios Git | *Bare repos* en `/home/admin/repos/*.git` (casazhef y portfolio) | Rideapp sigue el mismo patrón. |
| Otros proyectos | `casazhef` (frontend y backend) y `portfolio` | Rideapp no comparte con ellos base de datos, Redis ni cookies. |

### 13.2 Entornos

| Entorno | Dónde | Datos |
|---|---|---|
| local | **Tu PC**: `infra/docker-compose.yml` (Postgres + Redis) + `pnpm dev` | Seeds falsos |
| demo | Proyecto `rideapp` en Dokploy, en el VPS. Se despliega con cada push a `main` | Seeds falsos, **nunca datos reales** |
| producción | Más adelante: un segundo proyecto en Dokploy desplegado desde una rama `production` (o un VPS dedicado) | Reales |

### 13.3 Subdominios

En el DNS de `julian-lizcano.com` se crean registros `A` (y `AAAA` si hay IPv6) apuntando a `161.97.96.66`:

| Subdominio | Aplicación en Dokploy | Ruta |
|---|---|---|
| `rideapp-api.julian-lizcano.com` | `rideapp-api` (puerto 3000) | `/` → el API usa el prefijo global `/api`; las apps llaman a `https://rideapp-api.julian-lizcano.com/api/...` y el WebSocket va por `/socket.io/` |
| `rideapp-admin.julian-lizcano.com` | `rideapp-admin` (puerto 80) | `/` |
| `rideapp-admin.julian-lizcano.com` | `rideapp-api` (puerto 3000) | `/api`: la misma regla que usa casazhef. Traefik da prioridad a la regla más específica. |

- Traefik emite el certificado al guardar el dominio en Dokploy con HTTPS activado. **El DNS debe haberse propagado antes** (compruébalo con `dig +short rideapp-api.julian-lizcano.com`), porque el reto HTTP de Let's Encrypt lo necesita.
- El API también sirve `/.well-known/assetlinks.json` (Android App Links) desde `rideapp-api.julian-lizcano.com`.
- Cuando exista la marca, se compra un dominio propio y solo cambian la URL del API en las apps y las restricciones de las claves web.

### 13.4 Cómo están montados hoy los proyectos (casazhef como referencia)

```
Tu PC ──git push──► ssh://admin@161.97.96.66/home/admin/repos/zhef-backend.git   (bare repo)
                         │
                         └─ hooks/post-receive  (solo si el push es a main)
                               lee ~/.dokploy-api-key  +  zhef-backend.git/dokploy-app-id
                               POST https://dokploy.julian-lizcano.com/api/application.deploy
                                       { "applicationId": "<id>" }
                         ▼
Dokploy (aplicación "casazhef-backend-6abyhj")
  - Proveedor: Git por SSH, con la clave "dokploy" (autorizada en ~/.ssh/authorized_keys)
  - Clona main → construye el Dockerfile de la raíz → reemplaza el contenedor
  - Dominios: casazhef.com y www.casazhef.com con ruta /api → puerto 3000
```

- casazhef usa **un repo por aplicación** (`zhef-backend.git` y `zhef-frontend.git`) y un Dockerfile en la raíz de cada uno.
- **Rideapp usa un solo repo (monorepo)** porque la API, el admin y las apps comparten `packages/contracts`. Por eso cambian tres cosas respecto a casazhef:
  1. Cada aplicación de Dokploy apunta al **mismo repo** con un **Dockerfile distinto** (`apps/api/Dockerfile` y `apps/admin/Dockerfile`), con contexto de build en la raíz.
  2. El hook despliega **solo las aplicaciones afectadas** por los archivos modificados en el push.
  3. Postgres y Redis se crean como **servicios de base de datos de Dokploy**.
- Las apps móviles no se despliegan en el VPS: se compilan en tu PC y se distribuyen como APK (13.5, paso G).

### 13.5 Despliegue de rideapp paso a paso

#### A. Preparar tu PC (una sola vez)

1. Instala Node.js 24 LTS, pnpm 12 (`npm i -g pnpm@12`), Git, **Docker Desktop** y **Android Studio** (SDK de Android y JDK 17; para iOS más adelante, un Mac con Xcode).
2. Comprueba que tu clave SSH (la que ya usas para casazhef) funciona: `ssh admin@161.97.96.66 'echo ok'`.
3. (Opcional) Añade a `~/.ssh/config` un alias para escribir menos:
   ```
   Host vps
     HostName 161.97.96.66
     User admin
     IdentityFile ~/.ssh/id_ed25519
   ```

#### B. Crear el repositorio en el VPS (una sola vez)

Desde tu PC:

```bash
# 1. Repo bare en el VPS, con main como rama por defecto
ssh vps 'git init --bare -b main /home/admin/repos/rideapp.git'

# 2. En tu PC, dentro del proyecto
git init -b main            # si aún no es un repo
git remote add origin ssh://admin@161.97.96.66/home/admin/repos/rideapp.git
git add . && git commit -m "chore: estructura inicial del monorepo"
git push -u origin main     # todavía no despliega nada: el hook no está configurado
```

> En el VPS ya existe un borrador en `/home/admin/rideapp` (sección "Registro de avance"). Si quieres aprovecharlo, cópialo a tu PC con `scp -r vps:/home/admin/rideapp ./` (sin `node_modules`) antes del paso 2 y **después bórralo del VPS**, para no tener dos copias.

#### C. Crear los servicios en Dokploy

En `https://dokploy.julian-lizcano.com` → **Create Project** → `rideapp`. Dentro:

**C1. Postgres** (*Create Service → Database → PostgreSQL*)
- Nombre: `rideapp-db`. Imagen: **`postgis/postgis:17-3.5`** (la misma en tu `docker-compose.yml` local).
- Usuario `rideapp`, base de datos `rideapp` y una contraseña generada (`openssl rand -base64 32`).
- **Sin puerto externo** (deja vacío *External Port*).
- *Advanced → Resources*: memoria límite 1 GB, reserva 256 MB, CPU 1,5.
- Copia la **Internal Connection URL**: será `DATABASE_URL`.

**C2. Redis** (*Create Service → Database → Redis*)
- Nombre: `rideapp-redis`. Imagen: `redis:7-alpine`. Contraseña generada. **Sin puerto externo.**
- *Advanced → Resources*: memoria límite 256 MB, CPU 0,5.
- Configuración (en *Advanced*, si Dokploy permite sobrescribir el comando): `--maxmemory 192mb --maxmemory-policy noeviction --appendonly yes`. Si no lo permite, el API aplica `CONFIG SET` de esos valores al arrancar y lo verifica en `/api/health/ready`.
- Copia la **Internal Connection URL**: será `REDIS_URL`.

> Los servicios de Dokploy comparten la red `dokploy-network` con casazhef y portfolio. No son accesibles desde internet, pero sí desde esos contenedores, así que **las contraseñas deben ser largas y únicas**. Para aislarlos del todo, más adelante se pueden pasar a un Compose con red propia (13.8).

**C3. Aplicación `rideapp-api`** (*Create Service → Application*)
- *Provider*: **Git** (el mismo que casazhef) → URL `ssh://admin@161.97.96.66/home/admin/repos/rideapp.git`, rama `main`, clave SSH `dokploy`.
- *Build Type*: **Dockerfile**. *Docker File*: `apps/api/Dockerfile`. *Docker Context Path*: `.` (raíz del repo).
- *Environment* (nunca en el repo):
  ```
  NODE_ENV=production
  PORT=3000
  DATABASE_URL=<Internal Connection URL de rideapp-db>
  REDIS_URL=<Internal Connection URL de rideapp-redis>
  JWT_PRIVATE_KEY=<ES256 PEM, generada con openssl>      # ver 8.2
  JWT_PUBLIC_KEY=<...>
  JWT_KID=2026-09
  FIELD_ENCRYPTION_KEY=<32 bytes base64>
  GOOGLE_WEB_CLIENT_ID=<...>.apps.googleusercontent.com
  GOOGLE_MAPS_SERVER_KEY=<clave maps-server, restringida a 161.97.96.66>
  MAPS_PROVIDER=google
  CORS_ORIGINS=https://rideapp-admin.julian-lizcano.com
  PUBLIC_API_URL=https://rideapp-api.julian-lizcano.com
  ```
- *Domains*: los dos del API en la tabla 13.3 (HTTPS activado, Let's Encrypt).
- *Advanced → Resources*: memoria límite 768 MB, reserva 256 MB, CPU 1,5.
- Copia el **applicationId** (aparece en la URL del panel: `.../services/application/<applicationId>`).

**C4. Aplicación `rideapp-admin`**
- Mismo proveedor y rama. *Docker File*: `apps/admin/Dockerfile`. *Context*: `.`.
- *Environment → Build-time arguments*: `VITE_API_URL=/api` y `VITE_GOOGLE_MAPS_KEY=<clave maps-web-admin>` (esta clave termina en el navegador, así que va restringida por referente, ver 12.5).
- *Domains*: `rideapp-admin.julian-lizcano.com`, ruta `/`, puerto 80, HTTPS.
- *Advanced → Resources*: memoria límite 64 MB, CPU 0,25.
- Copia su **applicationId**.

**Presupuesto total: ~2,1 GB de RAM** (Postgres 1 GB + API 768 MB + Redis 256 MB + admin 64 MB). Si le va bien, se suben estos valores antes de pensar en mejorar el VPS.

#### D. Dockerfiles del monorepo (se crean en la Fase 0)

`/.dockerignore` (raíz):
```
**/node_modules
**/dist
**/.turbo
.git
.env*
apps/passenger
apps/driver
```

`apps/api/Dockerfile` (plantilla; se ajusta al crear el API):
```dockerfile
FROM node:24-alpine AS build
RUN npm i -g pnpm@12
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@rideapp/api...
# Copia solo el API y sus dependencias de producción (workspace incluido) a /out
RUN pnpm --filter=@rideapp/api deploy --prod /out

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /out ./
USER app
EXPOSE 3000
# Migraciones antes de arrancar (válido con una sola réplica)
CMD ["sh", "-c", "npx prisma migrate deploy && node --max-old-space-size=512 dist/main.js"]
```

`apps/admin/Dockerfile`:
```dockerfile
FROM node:24-alpine AS build
RUN npm i -g pnpm@12
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
ARG VITE_API_URL
ARG VITE_GOOGLE_MAPS_KEY
RUN pnpm turbo run build --filter=@rideapp/admin...

FROM nginx:alpine
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/admin/dist /usr/share/nginx/html
EXPOSE 80
```

`apps/admin/nginx.conf`: el mismo de casazhef (`try_files $uri $uri/ /index.html`) más las cabeceras de seguridad (11.2): `Content-Security-Policy`, `X-Content-Type-Options nosniff`, `X-Frame-Options DENY`, `Referrer-Policy strict-origin-when-cross-origin` y `Strict-Transport-Security "max-age=31536000"`. En el API, esas cabeceras las pone `@fastify/helmet`.

#### E. Hook de despliegue automático (en el VPS, una sola vez)

Es el hook de casazhef adaptado al monorepo: en lugar de un solo `dokploy-app-id`, lee `dokploy-apps`, con una aplicación por línea y las rutas que la afectan.

```bash
ssh vps
cd /home/admin/repos/rideapp.git

cat > dokploy-apps <<'EOF'
# nombre  applicationId          rutas que disparan su despliegue
api       <applicationId-api>    apps/api/ packages/contracts/ packages/config/ pnpm-lock.yaml package.json
admin     <applicationId-admin>  apps/admin/ packages/contracts/ packages/api-client/ packages/config/ pnpm-lock.yaml package.json
EOF
chmod 600 dokploy-apps
```

`hooks/post-receive` (luego `chmod +x hooks/post-receive`):
```bash
#!/bin/bash
# Despliega en Dokploy las aplicaciones de rideapp afectadas por un push a main.
#   API key:       ~/.dokploy-api-key       (la misma de casazhef)
#   Aplicaciones:  rideapp.git/dokploy-apps (nombre, applicationId y rutas)

DOKPLOY_URL="${DOKPLOY_URL:-https://dokploy.julian-lizcano.com}"
KEY_FILE="${HOME:-/home/admin}/.dokploy-api-key"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APPS_FILE="$REPO_DIR/dokploy-apps"
LOG="$REPO_DIR/dokploy-hook.log"
ZERO="0000000000000000000000000000000000000000"

deploy() {
  local name="$1" app_id="$2" body code
  body="$(mktemp)"
  code="$(curl -sS -o "$body" -w '%{http_code}' -m 30 -X POST \
    "$DOKPLOY_URL/api/application.deploy" \
    -H 'Content-Type: application/json' \
    -H "x-api-key: $(head -n1 "$KEY_FILE")" \
    -d "{\"applicationId\": \"$app_id\"}" 2>>"$LOG")"
  echo "$(date -Is) $name ${newrev:0:8} -> HTTP $code $(head -c 200 "$body")" >> "$LOG"
  rm -f "$body"
  case "$code" in
    2??) echo "remote: Dokploy: $name desplegando (HTTP $code)" ;;
    *)   echo "remote: Dokploy: ERROR en $name (HTTP $code), ver dokploy-hook.log" ;;
  esac
}

while read -r oldrev newrev ref; do
  [ "$ref" = "refs/heads/main" ] || continue
  [ "$newrev" != "$ZERO" ] || continue

  if [ ! -s "$KEY_FILE" ] || [ ! -s "$APPS_FILE" ]; then
    echo "$(date -Is) falta $KEY_FILE o $APPS_FILE" >> "$LOG"
    echo "remote: Dokploy: hook sin configurar, no se despliega"
    continue
  fi

  if [ "$oldrev" = "$ZERO" ]; then
    changed="*"
  else
    changed="$(git diff --name-only "$oldrev" "$newrev")"
  fi

  while read -r name app_id paths; do
    [ -z "$name" ] || [ "${name:0:1}" = "#" ] && continue
    hit=no
    if [ "$changed" = "*" ]; then
      hit=yes
    else
      for p in $paths; do
        if grep -qF -- "$p" <<< "$(cut -c1-${#p} <<< "$changed")"; then hit=yes; break; fi
      done
    fi
    if [ "$hit" = yes ]; then
      deploy "$name" "$app_id"
    else
      echo "remote: Dokploy: $name sin cambios, no se despliega"
    fi
  done < "$APPS_FILE"
done
```

Prueba: haz un cambio solo en `apps/admin/`, `git push`, y verás en la salida del push `admin desplegando` y `api sin cambios`. El historial queda en `rideapp.git/dokploy-hook.log`, y los logs de build, en Dokploy.

#### F. Primer despliegue y verificación

1. En Dokploy, pulsa **Deploy** a mano en `rideapp-api` y después en `rideapp-admin`, y revisa los logs de build.
2. Comprueba:
   - `curl -s https://rideapp-api.julian-lizcano.com/api/health/ready` → `200` con Postgres y Redis `up`;
   - `https://rideapp-admin.julian-lizcano.com` carga el login y sus llamadas a `/api` funcionan;
   - en *Monitoring* de Dokploy, cada contenedor está por debajo de su límite.
3. Carga los datos de demostración (usuarios, conductores y tarifas) con el comando de seed del API, ejecutado desde la terminal del contenedor en Dokploy (*Docker Terminal*): `node dist/cli.js seed --demo`.
4. Crea el admin: `node dist/cli.js create-admin --email <tu correo>` (muestra el QR o secreto de TOTP **una sola vez**).

#### G. Versiones funcionales de las apps móviles (APK)

1. **Keystore de release** (una sola vez): `keytool -genkeypair -v -storetype PKCS12 -keystore rideapp-release.keystore -alias rideapp -keyalg RSA -keysize 2048 -validity 10000`. **Guárdalo fuera del repo, con copia de seguridad y la contraseña en un gestor de contraseñas: si se pierde, no podrás publicar actualizaciones en Play.** Usa uno por app o uno compartido, pero decídelo desde el principio.
2. Registra la **SHA-1** de ese keystore (`keytool -list -v -keystore ...`) en:
   - el OAuth Client ID de Android de cada app (para el login con Google);
   - la clave `maps-android-*` de cada app (12.5).
3. `.env.production` de cada app (no versionado):
   ```
   EXPO_PUBLIC_API_URL=https://rideapp-api.julian-lizcano.com/api
   EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<...>
   GOOGLE_MAPS_ANDROID_KEY=<maps-android-passenger | maps-android-driver>
   ```
4. Compila en tu PC (gratis y sin límite): `npx expo prebuild -p android` y luego `cd android && ./gradlew assembleRelease`. El APK queda en `android/app/build/outputs/apk/release/`. Como alternativa, EAS Build en su plan gratuito.
5. Distribución de la demo: pasa el APK directamente (WhatsApp o Drive) o, cuando tengas la cuenta de Play (25 USD), usa **Pruebas internas** de Play Console, que además actualiza solo.
6. Nombra cada versión igual en el APK y en Git: `versionName` 0.1.0, `versionCode` incremental, y `git tag v0.1.0 && git push --tags`.

#### H. Flujo diario y marcha atrás

```
rama feat/... en tu PC ─► hooks de Husky en verde ─► merge a main ─► git push
      ─► post-receive ─► Dokploy construye y reemplaza solo lo que cambió
```

- **Si un despliegue falla en el build**, Dokploy mantiene el contenedor anterior funcionando.
- **Si se despliega algo roto:** `git revert <commit>` + `git push` (se redespliega la versión corregida). No uses `git push --force` sobre `main`.
- **Migraciones:** como se ejecutan al arrancar, una migración destructiva no se revierte con `git revert`. Por eso los cambios destructivos van en dos pasos (5.4) y siempre hay un backup del día (13.7).

### 13.6 Respaldo del código

El repo `rideapp.git` solo existe en el VPS y en tu PC. Añade un espejo privado gratuito (GitHub o GitLab) como **segunda URL de push**, así cada `git push` guarda una copia fuera del servidor:

```bash
git remote set-url --add --push origin ssh://admin@161.97.96.66/home/admin/repos/rideapp.git
git remote set-url --add --push origin git@github.com:<usuario>/rideapp.git
```

Con esto también se pueden activar Dependabot y los avisos de seguridad de GitHub sin depender de él para desplegar.

### 13.7 Endurecimiento y operación del VPS

Afectan a todo el servidor, así que hazlos con cuidado y en una ventana tranquila:

1. **Swap:** crea un *swapfile* de 4 GB con `vm.swappiness=10`, como red de seguridad ante picos de memoria.
2. **SSH:** solo con clave (`PasswordAuthentication no`, `PermitRootLogin no`); `fail2ban` y `unattended-upgrades`.
3. **Clave SSH de Dokploy:** hoy la clave `dokploy` de `authorized_keys` entra como `admin`, un usuario con `sudo`. Como solo la usa para clonar repos, **limítala a Git**: antepón `restrict,command="git-shell -c "$SSH_ORIGINAL_COMMAND""` a esa línea. Antes, confirma en Dokploy que la clave solo se usa como proveedor de Git (no como "servidor remoto") y prueba un Deploy de casazhef justo después del cambio.
4. **Firewall:** solo 22, 80 y 443. **Ojo:** Docker publica puertos saltándose `ufw`, así que el control real es **no publicar puertos** en ningún compose (Traefik es el único que publica).
5. **Backups de Postgres:**
   - desde `rideapp-db → Backups` en Dokploy (requiere configurar un destino S3 en *Settings → Destinations*) o con un `pg_dump` nocturno desde *Schedules*, cifrado con `age`;
   - copia **fuera del VPS**: si no quieres gastar, un almacenamiento S3 compatible con capa gratuita (Backblaze B2 o Cloudflare R2, ~10 GB gratis) o tu propio equipo por `rsync`;
   - retención de 7 diarios y 4 semanales;
   - **prueba de restauración una vez al mes.**
6. **Monitoreo:** el monitoreo integrado de Dokploy para CPU y RAM por contenedor, más **Uptime Kuma** (disponible como plantilla en Dokploy) vigilando `/health/ready`. GlitchTip para errores, cuando haga falta.

### 13.8 Escalado futuro (sin reescribir)

1. Primero, subir los límites de memoria y CPU en Dokploy (el VPS tiene margen); después, varias réplicas del API (*Advanced → Replicas*) detrás de Traefik (funciona porque el API no guarda estado y los sockets usan el adaptador de Redis).
2. Separar los *workers* de BullMQ en su propio contenedor (mismo código, otro comando de arranque).
3. Postgres con réplica de lectura para el historial y los informes; PgBouncer para el *pooling*.
4. Redis dedicado para la ubicación si el tráfico GPS crece.
5. Particionado geográfico con H3 cuando haya varias ciudades.
6. Extraer `location` y `matching` como servicios propios solo si las métricas lo justifican.
7. Aislar Postgres y Redis en un Compose de Dokploy con red propia, para que no compartan `dokploy-network` con los otros proyectos.

---

## 14. Seguridad: checklist por sección

> Referencias: **OWASP ASVS** (backend y web), **OWASP MASVS** (móvil) y **OWASP API Security Top 10**.

### 14.1 API / Backend

- [ ] **Autorización a nivel de objeto en todos los endpoints** (API1: BOLA/IDOR). Prueba automatizada: el usuario A intenta leer el viaje de B y debe recibir `404`.
- [ ] Validar **toda** entrada con Zod, en modo estricto y con límites de tamaño en strings y arrays.
- [ ] Límite de *body* global (p. ej., 100 KB) y otro específico para las subidas.
- [ ] Rate limiting por IP y por usuario, más estricto en auth, geo y creación de viajes.
- [ ] Nunca devolver campos internos: **DTOs de salida explícitos** (no serializar entidades de Prisma directamente; así no se filtra `password_hash`).
- [ ] Errores sin trazas ni mensajes de base de datos.
- [ ] Solo HTTPS, con HSTS.
- [ ] CORS con lista blanca exacta; nada de `*` con credenciales.
- [ ] Protección contra asignación masiva: el rol, el estado y el precio **nunca** vienen del cliente.
- [ ] Solo consultas parametrizadas (Prisma ya lo hace; en `$queryRaw` usa siempre *tagged templates*, **nunca** `$queryRawUnsafe` con entrada del usuario).
- [ ] Dependencias: `pnpm audit` en el `pre-push`, Trivy antes de cada demo y `pnpm outdated` mensual; lockfile versionado.
- [ ] Logs sin datos personales (redactados) y con `requestId`.
- [ ] El usuario de BD de la app no es propietario del esquema; las migraciones usan otro usuario.
- [ ] Tiempos de espera (*timeouts*) en todas las llamadas a Google Maps y a la BD.

### 14.2 Autenticación y sesiones

- [ ] Argon2id; política de contraseñas con lista de contraseñas comunes.
- [ ] Access token de 15 min como máximo; refresh token rotativo con detección de reutilización.
- [ ] Refresh tokens guardados como hash; revocación por sesión y "cerrar todas".
- [ ] Google: `verifyIdToken` con `audience` correcto, `email_verified`, identificación por `sub` y anti-replay.
- [ ] Vinculación de cuentas segura (ver 8.2) y notificada por correo.
- [ ] Admin con TOTP obligatorio y sin registro público.
- [ ] Recuperación de contraseña: token de un solo uso, 30 min de vigencia, hash en BD y respuesta idéntica exista o no el email.
- [ ] Rotación planificada de las claves JWT (`kid`).

### 14.3 Tiempo real (WebSocket)

- [ ] JWT en el handshake (`auth`), nunca en la URL.
- [ ] Salas asignadas por el servidor; el cliente nunca elige sala.
- [ ] Validación Zod de cada mensaje entrante y rate limit por socket.
- [ ] Desconexión al revocar la sesión o suspender al usuario.
- [ ] `maxHttpBufferSize` bajo (p. ej., 10 KB).
- [ ] Opción `cors` de Socket.IO restringida.

### 14.4 Ubicación y lógica del negocio

- [ ] La ubicación exacta de un conductor solo la ve el pasajero asignado, **y solo mientras el viaje está activo**.
- [ ] La dirección exacta del pasajero solo la ve el conductor asignado **después de aceptar** (en la oferta, solo la zona aproximada).
- [ ] Controles anti GPS falso: velocidad imposible, `accuracy` absurda y, en Android, `mocked` en la lectura de `expo-location`, que se registra y se marca.
- [ ] Precio calculado solo en el servidor, con cotización con caducidad.
- [ ] Máquina de estados con bloqueo optimista y lock en Redis para aceptar.
- [ ] PIN de inicio del viaje.
- [ ] Idempotencia en las acciones críticas.

### 14.5 Apps móviles

- [ ] Tokens solo en `expo-secure-store`.
- [ ] **Ningún secreto en el bundle**: los client IDs de Google no son secretos, y la clave de Maps SDK termina en la app pero va restringida por paquete/SHA-1 y a una sola API. Claves de servidor, de JWT o de pagos jamás van en la app.
- [ ] Solo HTTPS (en Android, `usesCleartextTraffic=false` en *release*).
- [ ] Validar los parámetros de *deep links* y los datos de los *push* antes de usarlos (nunca navegar a URLs arbitrarias).
- [ ] No registrar tokens ni ubicaciones en `console.log` en *release* (con `babel-plugin-transform-remove-console`).
- [ ] Borrar el almacenamiento seguro y la caché de TanStack Query al cerrar sesión.
- [ ] Ocultar contenido sensible al pasar a segundo plano (opcional en la demo).
- [ ] Permisos mínimos: el pasajero **no** pide ubicación en segundo plano.
- [ ] *Certificate pinning*: opcional; evaluarlo para producción (complica la rotación de certificados).
- [ ] Comprobación de versión mínima (`426 Upgrade Required`).

### 14.6 Panel web

- [ ] Cookies `HttpOnly`, `Secure` y `SameSite=Strict`, más protección CSRF.
- [ ] CSP estricta, `X-Frame-Options: DENY` y escape de todo el contenido generado por usuarios.
- [ ] Mínimo privilegio: roles de admin a futuro (`support` solo lectura, `ops` aprobaciones, `superadmin`).
- [ ] Auditoría de cada acción y de cada vez que se revela un dato enmascarado.
- [ ] Acceso restringido por IP o VPN si es posible.

### 14.7 Archivos

- [ ] Validación por *magic bytes*, límite de tamaño y eliminación del EXIF.
- [ ] Nombres aleatorios y almacenamiento privado cifrado.
- [ ] Acceso solo mediante URL firmada de corta duración o un endpoint autenticado.
- [ ] Nunca servir archivos subidos desde el mismo origen que el panel con `Content-Type` inferido; forzar `Content-Disposition: attachment` o el tipo validado.

### 14.8 Google Maps Platform

- [ ] Una clave por uso, cada una con restricción de aplicación **y** de API (tabla 12.5).
- [ ] La clave de servidor solo vive en el `.env` del VPS y está restringida a su IP.
- [ ] Cuotas diarias configuradas en todas las APIs con costo; alertas de presupuesto activas.
- [ ] Límites por usuario en `/geo/*` y validación de la zona de servicio antes de llamar a Google.
- [ ] gitleaks en el `pre-commit` detecta claves `AIza...` por si alguien la sube por error; si pasa, **se rota la clave** de inmediato (borrarla del historial no basta).
- [ ] Caché de coordenadas de Google de 30 días como máximo.

### 14.9 Infraestructura

- [ ] Solo Traefik publica puertos; Postgres y Redis de rideapp en su red interna, sin dominio y separados de los demás proyectos de Dokploy.
- [ ] El dashboard de Traefik (8080) sigue sin publicarse y el panel de Dokploy tiene 2FA.
- [ ] Límites de memoria y CPU en todos los servicios de rideapp en Dokploy.
- [ ] Cookies del admin con prefijo `__Host-` para que las otras aplicaciones de tu dominio no puedan leerlas ni sobrescribirlas.
- [ ] Contenedores con usuario no-root, sistema de archivos de solo lectura cuando sea posible y límites de memoria.
- [ ] Secretos fuera de Git, rotables y distintos en cada entorno.
- [ ] Backups cifrados, fuera del servidor y con restauración probada.
- [ ] SSH endurecido, firewall y actualizaciones automáticas.
- [ ] Staging **sin datos reales**.

---

## 15. Tratamiento de datos personales

> **Marco legal en Colombia:** Ley 1581 de 2012 (protección de datos personales), Decreto 1377 de 2013 (incorporado en el Decreto 1074 de 2015) y la **Superintendencia de Industria y Comercio (SIC)** como autoridad. Los plazos de conservación de datos contables y fiscales los fija la normativa tributaria (en general, al menos 5 años para soportes contables; confírmalo con un contador). **Revisa la versión final con un abogado antes de lanzar con usuarios reales.** Aparte de los datos personales, la regulación del transporte por plataformas en Colombia no está resuelta: conviene consultarlo también antes de operar comercialmente.

**Obligaciones prácticas de la Ley 1581:**

- **Autorización previa, expresa e informada** del titular para tratar sus datos, **guardando prueba de ella**: tabla `consents` (usuario, versión de la política, fecha y hora, IP y canal). Se pide en el registro, incluido el registro con Google.
- **Política de Tratamiento de la Información** publicada (en la app y en la web), con: responsable y datos de contacto, finalidades, derechos del titular, procedimiento para consultas y reclamos y fecha de vigencia.
- **Consultas y reclamos:** respuesta en **10 días hábiles** para consultas y **15 días hábiles** para reclamos. Habilita un correo o formulario de contacto para ello.
- **Datos sensibles:** la ubicación precisa y los datos biométricos requieren especial cuidado. Si algún día se usa reconocimiento facial para verificar conductores, hace falta una autorización específica y se puede negar.
- **Registro Nacional de Bases de Datos (RNBD):** obligatorio para sociedades y entidades sin ánimo de lucro con activos totales superiores a 100.000 UVT. Probablemente no aplique al inicio, pero revísalo cuando se constituya la empresa.
- **Incidentes de seguridad:** se reportan a la SIC (a través del RNBD) dentro de los **15 días hábiles** siguientes a su detección.
- **Transferencia internacional:** el VPS, Google y Expo pueden estar fuera de Colombia. Menciónalo en la política y cúbrelo en la autorización.

### 15.1 Inventario de datos

| Dato | Por qué se necesita | Dónde vive | Retención propuesta | Protección |
|---|---|---|---|---|
| Email, nombre | Cuenta y recibos | `users` | Mientras la cuenta esté activa; se anonimiza al borrarla | Acceso restringido |
| Teléfono | Contacto durante el viaje | `users` | Igual | Enmascarado en el admin |
| `sub` de Google | Login | `auth_identities` | Se borra con la cuenta | — |
| Hash de contraseña | Login | `users` | Se borra con la cuenta | Argon2id |
| Ubicación en vivo del conductor | Emparejamiento y seguimiento | Redis | **Segundos o minutos** (TTL) | Solo visible para el pasajero asignado |
| Traza GPS del viaje | Soporte, disputas y seguridad | `trip_route_points` | **90 días**; después se borra (se conservan solo la distancia y la duración) | Solo participantes y admin (con auditoría) |
| Origen y destino del viaje | Historial y recibo | `trips` | Mientras lo exija la ley fiscal; al borrar la cuenta, se redondean a ~1 km | — |
| Documentos del conductor | Verificación | Almacenamiento cifrado | Mientras sea conductor + el plazo legal; después se borran | Cifrado, URL firmada |
| Número de licencia | Verificación | `driver_profiles` | Igual | Cifrado de columna |
| Pagos | Contabilidad | `payments` | Plazo fiscal (normalmente 5–10 años) | Sin datos de tarjeta |
| IP y *user agent* | Seguridad y auditoría | `refresh_tokens`, `audit_logs` | 90–180 días | — |
| Push tokens | Notificaciones | `push_tokens` | Hasta cerrar sesión o que el token sea inválido | — |

### 15.2 Principios aplicados

1. **Minimización:** no pidas lo que no usas. Para la demo no hacen falta fecha de nacimiento, documento de identidad del pasajero ni contactos del teléfono.
2. **Consentimiento y transparencia:** política de privacidad accesible **antes** del registro; casilla de aceptación de términos (no premarcada) y consentimiento de ubicación explicado en la propia app.
3. **Finalidad:** los datos de ubicación se usan **solo** para el servicio (no para publicidad, en todo caso sin un consentimiento separado).
4. **Derechos del usuario:** exportar (`/me/export`), rectificar (`PATCH /me`) y eliminar (`DELETE /me`), implementados desde la demo, porque además las tiendas lo exigen.
5. **Retención automática:** un job nocturno aplica la tabla anterior. Documenta la política en `docs/security.md`.
6. **Seguridad por defecto:** cifrado en tránsito (TLS), cifrado de columnas sensibles y backups cifrados.
7. **Acceso interno mínimo y auditado:** los admins ven los datos enmascarados y cada revelación queda registrada.
8. **Brechas:** ten un procedimiento escrito: quién decide, cómo se revocan tokens y claves, cómo se avisa a los afectados y el reporte a la SIC en 15 días hábiles.
9. **Encargados de tratamiento:** la lista es corta: tu proveedor del VPS, Google (login y mapas: recibe los textos de búsqueda y las coordenadas de origen y destino, pero nunca el nombre del usuario, porque las llamadas salen del backend), Expo/FCM/APNs (push) y, a futuro, la pasarela de pagos. Deben figurar en la política de privacidad.
10. **Formularios de las tiendas:** la sección "Seguridad de los datos" de Google Play y las "Privacy Nutrition Labels" de Apple deben coincidir con esta tabla.

---

## 16. Pruebas y calidad

| Nivel | Herramienta | Qué cubrir como mínimo |
|---|---|---|
| Unitarias (API) | Vitest o Jest | Máquina de estados de viajes, cálculo de tarifa, verificación de Google (con un token simulado), rotación y reutilización de refresh tokens. |
| Integración (API) | Jest + Testcontainers (Postgres y Redis reales) | Flujo completo del viaje, carrera de dos conductores aceptando a la vez (**solo uno gana**) e IDOR en todos los endpoints con `:id`. |
| Contratos | Tests que validan las respuestas reales contra los esquemas Zod de `contracts` | Que el backend cumple lo que el mock prometía. |
| E2E móvil | **Maestro** (gratis) | Login → pedir viaje → el conductor acepta → completar → calificar. |
| E2E admin | Playwright | Login con TOTP y aprobación de un conductor. |
| Carga | **k6** | 500 conductores simulados enviando GPS cada 5 s y 50 solicitudes de viaje por minuto. Medir la latencia p95 y el uso de Redis. |
| Seguridad | **OWASP ZAP** (baseline) contra staging, gitleaks, Trivy y `pnpm audit` | Sin hallazgos altos antes de la demo. |

**Seeds:** un script que crea 1 admin, 5 pasajeros, 10 conductores aprobados con vehículos y un **simulador de conductores** (script que mueve conductores por rutas predefinidas en Girardot, Ricaurte y Flandes guardadas como polilíneas en el repo, sin gastar cuota de Google), útil tanto para desarrollar como para la demo en vivo.

---

## 17. Definición de "demo terminada"

- [ ] Un pasajero se registra con Google (y con email) en Android.
- [ ] Un conductor se registra, sube sus documentos y el admin lo aprueba desde el panel.
- [ ] El conductor se pone en línea y el pasajero lo ve cerca en el mapa.
- [ ] El pasajero busca un destino, ve la ruta y el precio, y pide el viaje.
- [ ] El conductor recibe la oferta, la acepta y el pasajero lo ve acercarse en tiempo real.
- [ ] Llegada, PIN, inicio, finalización y cobro en efectivo o simulado.
- [ ] Ambos se califican; el viaje aparece en ambos historiales y en el panel con su traza.
- [ ] El usuario puede exportar y eliminar su cuenta.
- [ ] Todo corre en el VPS con HTTPS, backups y monitoreo; la CI está en verde y no hay hallazgos altos de ZAP ni Trivy.

---

## 18. Qué queda fuera de la demo (fase 2)

- Pagos reales con pasarela (Stripe o Mercado Pago) y liquidaciones a conductores.
- Tarifa dinámica por demanda.
- Viajes programados y compartidos.
- Chat pasajero-conductor y llamadas enmascaradas (estas suelen requerir un proveedor de pago).
- Compartir viaje con enlace público y centro de seguridad completo.
- Varias ciudades o zonas con H3.
- Roles granulares de admin.
- Sign in with Apple completo y publicación en iOS (cuando exista la cuenta de Apple Developer).

---

### Próximo paso inmediato

1. **DNS:** crear `rideapp-api.julian-lizcano.com` y `rideapp-admin.julian-lizcano.com` apuntando a `161.97.96.66`.
2. **VPS:** añadir el *swapfile*, confirmar el 2FA de Dokploy y limitar la clave SSH `dokploy` (13.7).
3. **Google Cloud:** crear el proyecto, la pantalla de consentimiento OAuth y los Client IDs (web + Android de ambas apps); activar la facturación, **configurar primero las cuotas diarias** y las alertas (12.4) y después crear las claves restringidas (12.5).
4. **Tu PC:** preparar el entorno (13.5 A).
5. Ejecutar la **Fase 0** (sección 7) en tu PC: monorepo → contracts → docker compose → esqueleto del API (con `FakeMapsProvider`) → esqueletos de las apps → Husky.
6. **Primer despliegue:** repo en el VPS (13.5 B) → servicios en Dokploy (C) → hook (E) → verificación (F).

### Registro de avance

| Fecha | Avance |
|---|---|
| 2026-09-23 | Guía de configuración y despliegue en Dokploy basada en cómo está montado casazhef (13.4–13.5). Dominio de rideapp cambiado a `julian-lizcano.com`. |
| 2026-09-23 | Plan de trabajo. Revisión del VPS (sección 13.1). Inicio de la Fase 0 en `/home/admin/rideapp`, **en pausa**: configuración raíz del monorepo (pnpm, Turborepo, TypeScript, Prettier, `.gitignore`), `packages/config` y un borrador de `packages/contracts` (enums, `LatLng`, `Money`, auth, geo, tarifas con tests, eventos socket), sin compilar ni probar todavía. |
| 2026-10-01 | Fase 0 retomada **en el PC** (`D:\Server\rideapp`), no en el VPS. Hecho: raíz del monorepo (pnpm 12.8, Turborepo 2.11, TS 6.0.3, ESLint 10, Prettier), `packages/config`, `packages/contracts` (enums, comunes, auth, geo, tarifas con `roundFare`/`computeFare`, eventos socket) con build, typecheck, lint y 16 tests en verde; `infra/docker-compose.yml` (PostGIS 17-3.5 con usuario no superusuario, Redis con contraseña, Mailpit opcional, todo en 127.0.0.1), `service-area.geojson`, ADR 0001. Pendiente de la Fase 0: mock-server, esqueleto del API, apps Expo, admin, Husky + gitleaks. |
| 2026-10-01 | `packages/mock-server` (Fastify + Socket.IO; valida peticiones y respuestas contra contracts; simulador de 3 conductores por Girardot). Esqueleto de `apps/api`: NestJS 12 (ESM) + Fastify, entorno validado con Zod, Prisma 7 + adapter pg (migración inicial con PostGIS/citext), Redis, `/health/live` y `/health/ready`, pino con redacción, helmet, CORS, rate limiting en Redis, Swagger fuera de producción, `FakeMapsProvider` y Dockerfile. Sustitutos propios de `nestjs-zod` y del almacenamiento Redis del throttler porque aún no soportan Nest 12 (ADR 0002). **Corrección al plan:** pnpm 12 ya no lee `node-linker` de `.npmrc`; ahora es `nodeLinker: hoisted` en `pnpm-workspace.yaml`. 56 tests en verde (3 más se omiten sin Redis). Sin probar todavía: Postgres/Redis reales (Docker apagado) y `docker build`. |
| 2026-10-01 | Verificado con Docker: Postgres/PostGIS y Redis locales, migración inicial con usuario sin superusuario, tests del throttler contra Redis real, imagen del API (arranca, migra, usuario no root, healthcheck). `packages/api-client` (tipado, refresh único con cola, compatible con Hermes; tests de contrato contra el mock). `apps/admin`: React 19.2.3 + Vite 8 + React Router 7 + TanStack Query, dashboard con estado del API y mapa de la zona (si hay clave), imagen nginx con CSP, revisado en navegador (claro/oscuro, escritorio/móvil, consola sin avisos). Catálogo de pnpm + `overrides` para una sola copia de React (Prisma Studio traía otra). 68 tests. |
| 2026-10-01 | Husky: `pre-commit` (lint-staged + gitleaks del índice), `commit-msg` (commitlint) y `pre-push` (install congelado, lint/typecheck/test, `pnpm audit --prod --audit-level high`, gitleaks del historial). gitleaks usa el binario local o, si no hay, su imagen de Docker (`scripts/gitleaks.sh`). Probado: bloquea una clave `AIza…` y un mensaje no convencional. `overrides` para `mysql2` y `deepmerge-ts` (avisos altos en dependencias de la CLI de Prisma). |
| 2026-10-02 | Apps Expo SDK 57 (RN 0.86.3): `apps/passenger` (mapa + "¿A dónde vas?" + estado + conductores cercanos del mock) y `apps/driver` (mapa + interruptor En línea), con `packages/mobile-core` (mapa base y tema). Identificadores `com.norta.rideapp.passenger` y `.driver` (decididos el 2026-10-02). Pasajero probado en el emulador contra el mock-server. **Corrección al plan:** compilar con JDK 17 (Temurin); el JDK 25 de Android Studio rompe la configuración de CMake. Falta la clave de Maps SDK for Android. |
| 2026-10-02 | **Primer despliegue en Dokploy (fin de la Fase 0).** Proyecto `rideapp` con Postgres/PostGIS, Redis, API y admin (límites de 13.5 C, ~2,1 GB). DNS en Namecheap. `https://rideapp-api.julian-lizcano.com/api/health/ready` → 200 con BD y Redis; admin en `https://rideapp-admin.julian-lizcano.com` con `/api` al API; certificados de Let's Encrypt. Hook `post-receive` verificado: despliega solo lo que cambió. La API de Dokploy limita las peticiones por clave (responde 401). Detalles en `infra/dokploy/README.md`. |
| 2026-10-02 | APK release instalables de ambas apps (contra el API de producción, con mapa real). Problemas resueltos: (1) rutas de >260 caracteres en Windows con CMake 3.22.1 → CMake 3.31.6 (ninja 1.12) en `D:\AndroidStudio\cmake` y plugin `with-windows-cmake` que lo configura en cada `prebuild`; (2) `react-native-maps` 1.27.2 se cerraba con Fabric si llegaba `mapPadding` antes de `onMapReady` → parche con `pnpm patch` (`patches/`), sigue sin corregir en 1.29.0. Pendiente: avisos *peer* de `@react-native/metro-config` y `react-native-worklets` (expo-doctor 21/21 OK). |
| 2026-10-02 | Producción: API con el rol `rideapp_app` (sin superusuario) y swap de 4 GB en el VPS. **Fase 1a:** modelo de identidad (`users`, `auth_identities`, `refresh_tokens`, `consents`, `audit_logs`), registro/login con email, JWT ES256 con `kid`, refresh rotativo con detección de reutilización, logout y logout-all (también invalidan access tokens vigentes), `/me`, consentimiento Ley 1581, límites por IP y por email, auditoría. 16 tests de integración con Testcontainers (Postgres/PostGIS + Redis reales). Clave JWT de producción generada en el VPS. |
| 2026-10-02 | **Fase 1d:** sesión en el móvil (`SessionProvider`, refresh token en expo-secure-store), `packages/ui` y pantallas de bienvenida, registro (casilla de autorización + borrador de política), login y perfil, con rutas protegidas. Probado en el emulador: validación, registro, perfil, política, logout, logout-all, login fallido y correcto, y persistencia de la sesión al reabrir la app. **Fase 1c:** login con Google (verificación con google-auth-library, identificación por `sub`, anti-replay, consentimiento en cuentas nuevas, sin vinculación automática de cuentas con email sin verificar) y botón en las apps; 6 tests de integración nuevos (22 en total). |
| 2026-10-02 | **Fase 1e:** login del panel en dos pasos (contraseña + TOTP), CLI `create-admin` con QR en la terminal, secreto TOTP cifrado (AES-256-GCM), sesión en cookie `__Host-` HttpOnly + CSRF double-submit, 30 min de inactividad / 8 h máximo, `@AdminOnly()` y `GET /admin/overview`. Las sesiones conservan su `amr` al renovarse. Panel con pantallas de login/código y dashboard con usuarios por rol; probado en el navegador (incluida la recarga y el cierre de sesión). Corregido: dos refrescos simultáneos con la misma cookie cerraban la sesión (refresco único compartido). 30 tests de integración. Hallazgo: `pnpm --filter add` con `nodeLinker: hoisted` borra paquetes de otros workspaces (ver README). |
| 2026-10-02 | **Fase 1b — fin de la Fase 1.** Verificación de email y recuperación de contraseña con códigos de 6 dígitos (HMAC, 5 intentos, 24 h / 30 min, un solo uso), avisos por correo al vincular Google y al cambiar la contraseña, y servicio de correo con modos smtp/log/disabled. Probado con SMTP real (Mailpit) y en la app (recuperar contraseña, entrar con la nueva, verificar email). 39 tests de integración. Producción con `MAIL_TRANSPORT=disabled` hasta tener el correo del dominio: activarlo es solo configuración (`infra/dokploy/README.md`). |
