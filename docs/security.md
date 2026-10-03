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

## Correo: verificación y recuperación (Fase 1b)

- Códigos de 6 dígitos de un solo uso, guardados como **HMAC** con clave derivada del servidor; máximo 5 intentos; 24 h (verificación) y 30 min (recuperación).
- Emisión limitada: 1 por minuto y 5 por hora por usuario; recuperación además 5 por hora por email.
- `/auth/password/forgot` responde **siempre** 202 con el mismo cuerpo, exista o no la cuenta; los admins no recuperan por correo (CLI).
- Restablecer la contraseña cierra **todas** las sesiones y envía aviso; vincular Google envía aviso.
- Plantillas con el nombre del usuario escapado (sin HTML inyectable); sin datos sensibles más allá del código.
- `MAIL_TRANSPORT=log` prohibido en producción (los códigos acabarían en los logs). Hoy producción usa `disabled` hasta tener el SMTP del dominio.

## Conductores, documentos y ubicación (Fase 2)

| Control (8.4, 8.5, 8.10, 14.3, 14.4, 14.7) | Implementación                                                                                                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Número de licencia cifrado                 | AES-256-GCM en `driver_profiles.license_number_enc`; para mostrarla basta `license_last4`                                                                                                         |
| Subidas                                    | Multipart con 1 archivo y 5 MB máximo; tipo por **magic bytes** (`file-type`): JPEG, PNG o PDF                                                                                                    |
| EXIF / contenido oculto                    | Las imágenes se recodifican con sharp (sin metadatos, máximo 2400 px, límite de píxeles contra bombas de descompresión)                                                                           |
| Almacenamiento                             | `StorageService` en disco con AES-256-GCM por archivo; clave derivada con HKDF de `FIELD_ENCRYPTION_KEY`; nombres UUID, nunca el original                                                         |
| Acceso a documentos                        | Solo admin, con URL firmada (HMAC, clave derivada) de 5 min; cada apertura se audita. Tipo validado, `nosniff`, CSP `sandbox`, PDF como descarga                                                  |
| Datos enmascarados en el panel             | Teléfono `+57 *** *** 1234` y licencia `****1234`; revelarlos queda en `audit_logs` (`admin.driver_field_revealed`)                                                                               |
| Decisiones del admin                       | Bloqueo optimista (dos admins no pisan la decisión del otro) y auditoría de aprobar, rechazar, suspender y reactivar                                                                              |
| IDOR                                       | Todas las rutas del conductor operan sobre el usuario del token; las del admin filtran documento **y** conductor                                                                                  |
| Socket.IO                                  | JWT en `auth` del handshake; salas decididas por el servidor (`user:{id}`); solo WebSocket; `maxHttpBufferSize` 10 KB; CORS con la lista blanca                                                   |
| Mensajes de ubicación                      | Zod estricto, 1 por segundo por socket, `accuracy` ≤ 100 m, `ts` reciente, velocidad implícita ≤ 200 km/h y `mocked` de Android → descartadas y anotadas                                          |
| Sesiones revocadas                         | Cada 60 s se desconectan los sockets de sesiones cerradas y el conductor sale de línea                                                                                                            |
| Privacidad de la ubicación                 | Solo en Redis con TTL de 60 s; al pasar a "fuera de línea" se borra todo. El pasajero ve como máximo 10 conductores, **sin ID** y redondeados a ~100 m (redondeo, no ruido: el ruido se promedia) |

## Endurecimiento (Fase 6)

### Derechos del titular (8.3, 15.2)

| Derecho               | Implementación                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Acceso y portabilidad | `GET /me/export`: JSON con perfil, autorizaciones, sesiones (IP y user agent), datos de conductor (sin el número de licencia ni los archivos), viajes, pagos, calificaciones (las recibidas sin decir quién las dio), dispositivos de push y actividad propia de la auditoría. La traza GPS solo va en los viajes del conductor (es su ubicación; al pasajero no se le entrega la de otra persona). `Cache-Control: no-store`, 3 por minuto, auditado (`user.data_exported`). En la app se guarda en la caché y se comparte con el selector del sistema.                                                                                                                                                                                                                            |
| Rectificación         | `PATCH /me` (nombre y teléfono).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Supresión             | `DELETE /me` con `confirmation: "ELIMINAR"` y la contraseña si la cuenta tiene una (un access token robado no basta). No con un viaje en curso (409); los admins no (CLI). **Anonimiza**: email, contraseña, teléfono y nombre ("Usuario eliminado"); borra identidades de Google, códigos, push tokens, cotizaciones sin viaje, comentarios de sus calificaciones, IP/user agent de sus sesiones y la traza de sus viajes; los viajes se conservan (ley fiscal) con origen y destino redondeados a 2 decimales (~1 km), sin direcciones ni polilínea. Conductor: documentos borrados (filas y archivos), licencia vaciada, perfil suspendido y fuera de línea. Revoca todas las sesiones, avisa por socket (`ACCOUNT_DELETED`) y se audita (`user.deleted`, `user.delete_failed`). |

### Retención automática (15.1, 15.2 punto 5)

Job `data-retention` de BullMQ cada 6 h (idempotente; `modules/privacy/retention.service.ts`):

| Dato                                 | Plazo                                           |
| ------------------------------------ | ----------------------------------------------- |
| Traza GPS (`trip_route_points`)      | 90 días; el viaje conserva distancia y duración |
| IP en `audit_logs`                   | 180 días (el registro se conserva sin la IP)    |
| Refresh tokens caducados o revocados | 7 días después de caducar                       |
| Códigos de correo                    | 1 día después de caducar                        |
| Push tokens sin uso                  | 180 días sin abrir la app                       |
| Cotizaciones caducadas sin viaje     | cada hora (Fase 3)                              |

### Otros controles (14.1, 14.5)

- Límite de cuerpo JSON de **100 KB** (antes 1 MB); las subidas multipart tienen su propio tope (5 MB).
- Tiempos de espera: Postgres (`connectionTimeoutMillis` 5 s, `statement_timeout` 10 s, `idle_in_transaction_session_timeout` 15 s) y Redis (conexión y comando 5 s).
- **Versión mínima de las apps:** `MIN_APP_VERSION` en el API; si `X-App-Version` es menor, `426 UPGRADE_REQUIRED` y la app muestra "Actualiza la app" en lugar de fallar pantalla por pantalla. Sin la variable no se comprueba.
- Informes del panel (`GET /admin/reports`): solo agregados, sin datos de personas; máximo 62 días.
- `cli:load-fixtures` (usuarios sintéticos para k6) se niega a ejecutarse con `NODE_ENV=production`; su salida (`infra/load/fixtures.json`, con tokens) está en `.gitignore`.

### Escaneos antes de la demo (16, 14.1)

| Herramienta                            | Objetivo                       | Resultado (2026-10-02)                                                                                                                                                                                                                                                                                    |
| -------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trivy (`--severity HIGH,CRITICAL`)     | Imagen del API                 | 0. Las 8 altas iniciales estaban en el `npm` de `node:24-alpine`, que no se usa en ejecución: se quita de la imagen.                                                                                                                                                                                      |
| Trivy                                  | Imagen del panel               | 0. Las 43 iniciales eran paquetes de Alpine de `nginx:1.29-alpine` con parche: `apk upgrade` al construir y fuera `curl`.                                                                                                                                                                                 |
| OWASP ZAP baseline                     | Panel (imagen nginx, en local) | 0 FAIL, 62 PASS, 5 avisos bajos: `style-src 'unsafe-inline'` (excepción de Google Maps, arriba), falta `Cross-Origin-Embedder-Policy` (exigirlo rompería los recursos de Google Maps), comentarios en el JS minificado, contenido cacheable (los _assets_ con hash) y "aplicación moderna" (informativo). |
| k6                                     | API (en local)                 | Ver `infra/load/README.md`.                                                                                                                                                                                                                                                                               |
| `pnpm audit --prod --audit-level high` | Dependencias                   | En el `pre-push` (Fase 0).                                                                                                                                                                                                                                                                                |

Pendiente: ZAP baseline contra el API y el panel **desplegados** (con TLS y Traefik delante) después del próximo despliegue.

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

| Aviso                      | Paquete                      | Motivo                                                                                                             | Revisar                    |
| -------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| GHSA-86w9-cpqp-85rv (alta) | `node-forge` vía `@expo/cli` | Solo en la CLI de Expo en el PC; no llega al APK ni al servidor. Sin versión corregida.                            | Al actualizar Expo         |
| GHSA-vfj7-8cjw-p6xm (alta) | `braces` vía `metro`         | Solo en Metro (empaquetador en el PC) con patrones propios; no llega al APK ni al servidor. Sin versión corregida. | Al actualizar React Native |

Configuradas en `auditConfig.ignoreGhsas` de `pnpm-workspace.yaml`.
