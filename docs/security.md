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

## Autenticación (Fase 1)

| Control (14.2)                                                   | Implementación                                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Argon2id (19 MiB, t=2, p=1)                                      | `@node-rs/argon2` (binarios precompilados para Alpine y Windows)                                  |
| Política de contraseñas                                          | ≥ 10 caracteres + lista local de 9.077 contraseñas comunes + no contener el email + no repetitiva |
| Errores de login genéricos y tiempo constante                    | Verificación contra un hash ficticio si el email no existe                                        |
| Access token ≤ 15 min, ES256, `kid`, sin datos personales        | `TokenService` (`sub`, `role`, `sid`, `amr`)                                                      |
| Refresh token rotativo, solo hash SHA-256 en BD                  | `SessionService`; reutilizar uno rotado revoca la familia (sesión)                                |
| Logout / logout-all invalidan también los access tokens vigentes | `auth:revoked-sid:*` en Redis durante el TTL del access token                                     |
| Rate limiting                                                    | 5/min por IP en registro y login; 10 intentos por email cada 15 min desde cualquier IP            |
| Rutas privadas por defecto                                       | `AuthGuard` global; las públicas se marcan con `@Public()`                                        |
| Consentimiento (Ley 1581)                                        | Tabla `consents` con versión de política, fecha, IP y canal                                       |
| Auditoría                                                        | `audit_logs`: registro, login, login fallido (con hash del email), logout, reutilización de token |

Clave JWT de producción: generada en el VPS con openssl y guardada solo en Dokploy (`JWT_KID=2026-10`).

## Login con Google (Fase 1c)

- `verifyIdToken` con `audience` = Client ID web; `iss` de Google; `email_verified` obligatorio.
- Usuario identificado por `sub` (`auth_identities`), nunca por el email.
- Anti-replay: cada idToken abre como máximo una sesión (`google:idtoken:*` en Redis hasta su `exp`).
- **No se vincula** automáticamente una cuenta con contraseña cuyo email no esté verificado (toma de cuenta); si está verificado, se vincula y se audita (`auth.google_linked`). Pendiente (1b): avisar por correo.

## Panel admin (Fase 1e)

| Control (8.14, 11.1, 11.2) | Implementación                                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Sin registro público       | CLI `create-admin` dentro del contenedor                                                                                         |
| TOTP obligatorio           | Reto de 5 min tras la contraseña; ±1 intervalo; **cada código vale una vez** (`last_used_step`); bloqueo tras 5 fallos           |
| Secreto TOTP cifrado       | AES-256-GCM con `FIELD_ENCRYPTION_KEY` (generada en el VPS, solo en Dokploy)                                                     |
| Sesión con cookies         | Refresh token en `__Host-rideapp_admin_rt` (HttpOnly, Secure, SameSite=Strict, Path=/, sin Domain); access token solo en memoria |
| CSRF                       | Double-submit: cookie `__Host-rideapp_admin_csrf` + cabecera `X-CSRF-Token` en refresh y logout                                  |
| Caducidad                  | 30 min de inactividad y 8 h como máximo                                                                                          |
| `/admin/*`                 | `@AdminOnly()`: rol ADMIN **y** `amr` con `totp`                                                                                 |

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
