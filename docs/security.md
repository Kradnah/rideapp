# Seguridad

Checklist completa en la sección 14 del plan. Aquí se registran las decisiones y excepciones concretas a medida que se implementan.

## Implementado (Fase 0)

| Control                                                                                                                                 | Dónde                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Variables de entorno validadas al arrancar; los errores no muestran valores                                                             | `apps/api/src/config/env.ts`                                      |
| CORS con lista blanca; solo `https://` en producción                                                                                    | `env.ts`, `app.factory.ts`                                        |
| Cabeceras de seguridad (helmet) con CSP `default-src 'none'` en producción                                                              | `app.factory.ts`                                                  |
| Errores siempre como `ApiError`, sin trazas ni mensajes internos                                                                        | `common/filters/api-exception.filter.ts`                          |
| Validación estricta (campos desconocidos rechazados)                                                                                    | `common/zod/` + `strictObject` en contracts                       |
| Rate limiting global en Redis (120 por minuto por IP)                                                                                   | `infra/throttler/`                                                |
| Logs sin cabeceras `Authorization`/`Cookie`, sin query string y con redacción de `password`, `idToken`, `lat`, `lng`, `phone`, `email`… | `common/logging/logger.options.ts`                                |
| `X-Request-Id` entrante aceptado solo con formato seguro (evita inyección en logs)                                                      | `app.factory.ts`                                                  |
| Swagger desactivado en producción                                                                                                       | `app.factory.ts`                                                  |
| Imagen Docker con usuario no root; `.env*` excluidos del contexto y del paquete desplegado                                              | `apps/api/Dockerfile`, `.dockerignore`, `files` en `package.json` |
| Postgres y Redis locales solo en `127.0.0.1`; usuario de BD sin superusuario                                                            | `infra/docker-compose.yml`                                        |

## Pendiente o a vigilar

- **Postgres en producción:** el API usa el rol `rideapp_app` (sin superusuario, dueño del esquema `public`). PostGIS no es una extensión _trusted_: si una migración futura necesita otra extensión, la crea antes el superusuario `rideapp`.
- **Swap de 4 GB** en el VPS con `vm.swappiness=10` (13.7), activo desde el 2026-10-02.
- `TRUST_PROXY=true` en Dokploy (detrás de Traefik); si no, todas las peticiones parecen venir de la IP de Traefik y el rate limiting las agrupa.
- Límites estrictos en `/auth/*` (Fase 1).

## Panel admin (Fase 0)

- nginx con CSP, `X-Frame-Options DENY`, HSTS, `nosniff`, `Referrer-Policy` y `Permissions-Policy` (`apps/admin/nginx/`).
- **Excepción a 11.2:** `style-src` incluye `'unsafe-inline'` porque Google Maps JS inyecta estilos en línea (guía oficial de CSP de Maps). `script-src` **no** lleva `unsafe-inline` ni `unsafe-eval`.
- Zod en modo `jitless` en el navegador, para no necesitar `unsafe-eval` (`apps/admin/src/zod-config.ts`).
- ESLint prohíbe `dangerouslySetInnerHTML`.

## Apps móviles (Fase 0)

- Claves de Maps solo por variable de entorno de build (`.env.local`, ignorado por Git); nunca en el código.
- Sin clave, la app no crea el mapa (el SDK de Google se cerraría) y muestra un aviso.
- El pasajero tiene bloqueado `ACCESS_BACKGROUND_LOCATION`. El conductor también, hasta la Fase 2 (10.2).
- **Keystore de depuración:** `expo prebuild` usa el keystore público de React Native (SHA-1 `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`). Vale para restringir las claves de **desarrollo**, pero cualquiera puede firmar con él. Antes de distribuir APKs: keystore propio de release (fuera de Git) y su SHA-1 en las claves de Maps y OAuth.
- La "sesión de demo" (`EXPO_PUBLIC_DEMO_SESSION`) solo funciona contra el mock-server y se elimina en la Fase 1.

## Excepciones de auditoría de dependencias

| Aviso                      | Paquete                      | Motivo                                                                                  | Revisar            |
| -------------------------- | ---------------------------- | --------------------------------------------------------------------------------------- | ------------------ |
| GHSA-86w9-cpqp-85rv (alta) | `node-forge` vía `@expo/cli` | Solo en la CLI de Expo en el PC; no llega al APK ni al servidor. Sin versión corregida. | Al actualizar Expo |

Configuradas en `auditConfig.ignoreGhsas` de `pnpm-workspace.yaml`.
