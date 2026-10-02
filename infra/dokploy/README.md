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
- El usuario `rideapp` de Postgres lo crea Dokploy como superusuario (13.5 C1). Desde el 2026-10-02 el API usa **`rideapp_app`** (sin superusuario; dueño del esquema `public`). `rideapp` queda solo para administración. Consecuencia: una migración futura que necesite `CREATE EXTENSION` debe ejecutarla antes un superusuario.
- Las contraseñas de Postgres y Redis se generaron en el VPS y solo viven en Dokploy.

## Activar el correo (cuando exista el SMTP del dominio)

Hoy `MAIL_TRANSPORT=disabled`: verificación de email y recuperación de contraseña existen pero no envían nada (la app muestra "el envío de correos aún no está disponible"). Para activarlo, en Dokploy → `rideapp-api` → Environment, sin tocar código:

```
MAIL_TRANSPORT=smtp
SMTP_HOST=<servidor SMTP del proveedor del dominio>
SMTP_PORT=587            # 465 si el proveedor usa TLS implícito (entonces SMTP_SECURE=true)
SMTP_SECURE=false
SMTP_USER=no-reply@<dominio>
SMTP_PASSWORD=<contraseña>   # guardarla con `read -rsp` en el VPS y pasarla desde allí, nunca por chat
MAIL_FROM=rideapp <no-reply@<dominio>>
```

Y redesplegar. Comprobar que el VPS llega al puerto (`timeout 8 bash -c "exec 3<>/dev/tcp/<host>/587"`) y configurar SPF/DKIM del dominio para que los correos no acaben en spam. En producción el STARTTLS es obligatorio.

## Volumen de documentos de conductores (Fase 2)

Los documentos que suben los conductores se guardan cifrados en `STORAGE_DIR` (por defecto `/app/var/storage` dentro del contenedor). Sin volumen se perderían en cada despliegue. En Dokploy → `rideapp-api` → Advanced → Volumes:

- Tipo **Volume mount**, nombre `rideapp-api-storage`, ruta `/app/var/storage`.

Docker inicializa el volumen nuevo con el propietario de la carpeta de la imagen (usuario `app`, permisos 700). La clave de cifrado se deriva de `FIELD_ENCRYPTION_KEY`: **si se pierde esa variable, los archivos no se pueden recuperar**; incluir el volumen y la variable en los backups (13.6).

Socket.IO usa el mismo dominio del API (`wss://rideapp-api.julian-lizcano.com/socket.io`); Traefik reenvía WebSocket sin configuración extra.
