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

- **PostGIS en Dokploy:** no es una extensión _trusted_. Antes del primer `migrate deploy`, un superusuario debe ejecutar `CREATE EXTENSION postgis; CREATE EXTENSION citext;` en `rideapp`. Lo ideal es que la app use después un rol sin superusuario (en Dokploy el `POSTGRES_USER` es superusuario).
- `TRUST_PROXY=true` en Dokploy (detrás de Traefik); si no, todas las peticiones parecen venir de la IP de Traefik y el rate limiting las agrupa.
- Límites estrictos en `/auth/*` (Fase 1).

## Panel admin (Fase 0)

- nginx con CSP, `X-Frame-Options DENY`, HSTS, `nosniff`, `Referrer-Policy` y `Permissions-Policy` (`apps/admin/nginx/`).
- **Excepción a 11.2:** `style-src` incluye `'unsafe-inline'` porque Google Maps JS inyecta estilos en línea (guía oficial de CSP de Maps). `script-src` **no** lleva `unsafe-inline` ni `unsafe-eval`.
- Zod en modo `jitless` en el navegador, para no necesitar `unsafe-eval` (`apps/admin/src/zod-config.ts`).
- ESLint prohíbe `dangerouslySetInnerHTML`.
