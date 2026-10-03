# Prueba de carga (sección 16)

Objetivo del plan: **500 conductores enviando GPS cada 5 s** por Socket.IO y **50 solicitudes de viaje por minuto**, midiendo la latencia p95 y el uso de Redis. Script: `rideapp-load.js` (k6, por Docker).

k6 no trae cliente de Socket.IO: el script habla Engine.IO v4 sobre WebSocket a mano. Cada conductor se pone en línea, envía su posición cada 5 s (ack medido en `location_ack_ms`) y acepta o rechaza al 50 % las ofertas que recibe. Los pasajeros cotizan y piden un viaje (y cancelan el anterior si sigue activo).

## Cómo ejecutarla (solo en local o staging, nunca contra producción)

```bash
# 1. Usuarios sintéticos (500 conductores aprobados y 50 pasajeros) con access tokens de 15 min.
#    Se niega a correr con NODE_ENV=production. El JSON con tokens está en .gitignore.
pnpm --filter @rideapp/api cli:load-fixtures --drivers 500 --passengers 50 --out ../../infra/load/fixtures.json

# 2. API compilada, escuchando para Docker y con TRUST_PROXY=true: el script da una IP distinta a cada
#    usuario (X-Forwarded-For) para que el límite por IP se reparta como con clientes reales.
cd apps/api && pnpm build
PORT=3100 HOST=0.0.0.0 TRUST_PROXY=true LOG_LEVEL=warn node dist/main.js

# 3. k6 (desde la raíz del repo, Git Bash).
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD/infra/load:/load" grafana/k6 run \
  -e API=http://host.docker.internal:3100 -e FIXTURES=/load/fixtures.json \
  -e DRIVERS=500 -e DURATION=5m /load/rideapp-load.js

# 4. Limpieza: borra los usuarios de carga y sus viajes.
pnpm --filter @rideapp/api cli:load-fixtures --purge
```

Umbrales (fallan la ejecución si no se cumplen): ack de ubicación p95 < 250 ms, cotizar y crear viaje p95 < 800 ms y menos del 2 % de peticiones fallidas.

## Resultados

**2026-10-02, en local** (PC con Windows 11, Docker Desktop; API compilada en un solo proceso, Postgres y Redis de `infra/docker-compose.yml`, `MAPS_PROVIDER=fake`), 500 conductores durante 5 min y 50 viajes por minuto:

| Métrica                           | Resultado                                                 | Umbral            |
| --------------------------------- | --------------------------------------------------------- | ----------------- |
| Ack de ubicación (Socket.IO)      | p95 **3 ms** (máx. 40 ms), ~100 mensajes/s, 0 rechazados  | p95 < 250 ms      |
| `POST /trips/quote`               | p95 **15 ms**                                             | p95 < 800 ms      |
| `POST /trips`                     | p95 **27 ms**                                             | p95 < 800 ms      |
| Peticiones fallidas               | **0,05 %** (1 de 1.929: un _timeout_ del proxy de Docker) | < 2 %             |
| Viajes creados / ofertas enviadas | 251 / 475                                                 | —                 |
| Memoria del API                   | ~225 MB estables (límite en Dokploy: 768 MB)              | —                 |
| CPU del API                       | ~7 % de un núcleo                                         | —                 |
| Redis                             | ~8,7 MB, 350–2.300 operaciones/s                          | 256 MB en Dokploy |

Conclusión: con un solo proceso hay margen de sobra para la demo y bastante más; el cuello de botella no está en el API ni en Redis.

**Lecciones de las ejecuciones fallidas** (ya corregidas en el script):

1. En k6, `__VU` es global entre escenarios: con los pasajeros, algunos conductores se repetían (dos VUs con el mismo token) y el servidor descartaba sus posiciones por velocidad imposible. Se usa `exec.scenario.iterationInTest`.
2. Abrir 500 conexiones en el mismo milisegundo desborda el proxy de Docker Desktop (`connection refused`, el API ni las ve). Los conductores entran escalonados en 20 s, que además se parece más a la realidad.

Pendiente: repetirla contra staging en el VPS (mismo script, `API=https://…`) cuando exista un entorno separado de producción; nunca contra producción con datos reales.
