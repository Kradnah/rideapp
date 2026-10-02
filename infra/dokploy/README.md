# Despliegue en Dokploy (13.5)

| Servicio           | Dokploy                                               | Nombre interno              | Recursos                          |
| ------------------ | ----------------------------------------------------- | --------------------------- | --------------------------------- |
| Postgres + PostGIS | `rideapp-db` (`postgis/postgis:17-3.5`)               | `rideapp-db-zxko4e:5432`    | 1 GB / 256 MB reserva / 1,5 CPU   |
| Redis              | `rideapp-redis` (`redis:7-alpine`, `noeviction`, AOF) | `rideapp-redis-wftiub:6379` | 256 MB / 0,5 CPU                  |
| API                | `rideapp-api` · `CufiXZgtTqBr0V1Dr45Tz`               | —                           | 768 MB / 256 MB reserva / 1,5 CPU |
| Admin              | `rideapp-admin` · `iXvo4Ya_cqkwKtEOefDGW`             | —                           | 64 MB / 0,25 CPU                  |

Dominios (Let's Encrypt): `rideapp-api.julian-lizcano.com` → API · `rideapp-admin.julian-lizcano.com` → admin, y su `/api` → API.

## Flujo

`git push` a `main` → hook `post-receive` del repo bare (`/home/admin/repos/rideapp.git`) → lee `dokploy-apps` → llama a `application.deploy` **solo para las apps cuyas rutas cambiaron**. El hook usa `~/.dokploy-api-key`. La copia versionada del hook está en este directorio (`post-receive`).

## Aprendido al configurarlo

- **La API de Dokploy limita las peticiones por clave.** Tras unas decenas de llamadas seguidas responde `401 Unauthorized` (no 429) y se recupera al rato. No es un problema de permisos: espaciar las llamadas o esperar.
- `environment.one` no devuelve `appName` de los servicios; hay que pedir `postgres.one` / `redis.one`. Dokploy añade un sufijo aleatorio al `appName`.
- El usuario `rideapp` de Postgres lo crea Dokploy como superusuario (13.5 C1). Pendiente para la Fase 6: rol de aplicación sin superusuario.
- Las contraseñas de Postgres y Redis se generaron en el VPS y solo viven en Dokploy.
