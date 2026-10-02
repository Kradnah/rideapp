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

## Activar el correo (SMTP de Hostinger)

Hasta activarlo, `MAIL_TRANSPORT=disabled`: verificación de email y recuperación de contraseña existen pero no envían nada (la app muestra "el envío de correos aún no está disponible"). El buzón es `no-reply@nortaestudio.com` (correo de Hostinger). En Dokploy → `rideapp-api` → Environment, sin tocar código:

```
MAIL_TRANSPORT=smtp
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_SECURE=true             # TLS implícito; si el VPS no llega al 465: SMTP_PORT=587 y SMTP_SECURE=false (STARTTLS)
SMTP_USER=no-reply@nortaestudio.com
SMTP_PASSWORD=<contraseña>   # solo en Dokploy, nunca en el repo ni por chat
MAIL_FROM=rideapp <no-reply@nortaestudio.com>
```

Y redesplegar. Comprobar antes que el VPS llega al puerto (`timeout 8 bash -c "exec 3<>/dev/tcp/smtp.hostinger.com/465" && echo ok`).

DNS de `nortaestudio.com` (revisado el 2026-10-02, gestionado en Hostinger): SPF `include:_spf.mail.hostinger.com`, DKIM con los CNAME `hostingermail-{a,b,c}._domainkey`, DMARC `p=none`. Cuando los envíos lleguen bien, endurecer DMARC a `p=quarantine`.

## Volumen de documentos de conductores (Fase 2)

Los documentos que suben los conductores se guardan cifrados en `STORAGE_DIR` (por defecto `/app/var/storage` dentro del contenedor). Sin volumen se perderían en cada despliegue. En Dokploy → `rideapp-api` → Advanced → Volumes:

- Tipo **Volume mount**, nombre `rideapp-api-storage`, ruta `/app/var/storage`.

**Creado el 2026-10-02** con la API (`mounts.create`, `mountId` `FBICxdXxWjfASur9hb3D_`). El primer despliegue que lo monte debe usar ya la imagen de la Fase 2 (con `/app/var/storage` del usuario `app`): un volumen nuevo copia el propietario de la carpeta de la imagen, y con una imagen anterior quedaría de `root` y el API no podría escribir.

Docker inicializa el volumen nuevo con el propietario de la carpeta de la imagen (usuario `app`, permisos 700). La clave de cifrado se deriva de `FIELD_ENCRYPTION_KEY`: **si se pierde esa variable, los archivos no se pueden recuperar**; incluir el volumen y la variable en los backups (13.6).

## Activar Google Maps en el API (Fase 3)

Hoy `MAPS_PROVIDER=fake`: rutas en línea recta × 1,3 y un puñado de lugares fijos de Girardot. Para usar Google (sección 12), **primero** configura las cuotas diarias y la clave `maps-server` restringida a la IP del VPS (12.4–12.5) y luego, en Dokploy → `rideapp-api` → Environment:

```
MAPS_PROVIDER=google
GOOGLE_MAPS_SERVER_KEY=<clave maps-server>   # nunca en el repo ni en las apps
```

Y redesplegar. El panel muestra en el dashboard las llamadas del día por SKU. Si Google agota la cuota, las cotizaciones siguen funcionando con la ruta aproximada (queda un aviso en el log); el buscador responde "no disponible" y el pasajero puede elegir el punto en el mapa.

La migración de la Fase 3 (`trips`) no crea extensiones: la puede aplicar `rideapp_app`. BullMQ usa el mismo Redis y necesita `maxmemory-policy noeviction` (13.5 C2).

Socket.IO usa el mismo dominio del API (`wss://rideapp-api.julian-lizcano.com/socket.io`); Traefik reenvía WebSocket sin configuración extra.
