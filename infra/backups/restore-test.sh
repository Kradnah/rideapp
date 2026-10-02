#!/usr/bin/env bash
# Prueba de restauración (13.7: una vez al mes). Descifra un volcado, lo restaura en un Postgres
# TEMPORAL (nunca en el de producción) y comprueba que los datos tienen sentido. Se ejecuta donde
# esté la clave privada de age (tu PC), no en el VPS.
#
# Uso:
#   AGE_IDENTITY=~/.config/rideapp-backup/key.txt ./restore-test.sh rideapp-db-20261003-0700.dump.age
set -euo pipefail

DUMP="${1:?Uso: restore-test.sh <rideapp-db-*.dump.age>}"
: "${AGE_IDENTITY:?Define AGE_IDENTITY (clave privada de age)}"
IMAGE="${IMAGE:-postgis/postgis:17-3.5}"
NAME="rideapp-restore-test-$$"
PASSWORD="$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "Arrancando Postgres temporal ($IMAGE)…"
docker run -d --name "$NAME" -e POSTGRES_PASSWORD="$PASSWORD" -e POSTGRES_DB=rideapp "$IMAGE" >/dev/null
until docker exec "$NAME" pg_isready -U postgres -d rideapp >/dev/null 2>&1; do sleep 1; done
# PostGIS y citext los crea la migración inicial; en el volcado vienen como CREATE EXTENSION.
sleep 2

echo "Descifrando y restaurando $DUMP…"
age -d -i "$AGE_IDENTITY" "$DUMP" \
  | docker exec -i "$NAME" pg_restore -U postgres -d rideapp --no-owner --exit-on-error

q() { docker exec "$NAME" psql -U postgres -d rideapp -tAc "$1"; }
echo
echo "Migraciones aplicadas: $(q 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL')"
echo "Última migración:      $(q 'SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 1')"
echo "Usuarios:              $(q 'SELECT count(*) FROM users')"
echo "Viajes:                $(q 'SELECT count(*) FROM trips')"
echo "Pagos:                 $(q 'SELECT count(*) FROM payments')"
echo "Zona de servicio:      $(q 'SELECT count(*) FROM service_areas WHERE active')"
# Una consulta con PostGIS demuestra que la extensión y las columnas geography sobrevivieron.
echo "PostGIS:               $(q "SELECT ST_Covers(area, ST_GeogFromText('POINT(-74.8036 4.3035)')) FROM service_areas LIMIT 1")"

USERS="$(q 'SELECT count(*) FROM users')"
[ "$USERS" -gt 0 ] || { echo 'FALLO: la restauración no tiene usuarios' >&2; exit 1; }
echo
echo "OK: el backup se puede restaurar. Anota la fecha de esta prueba en infra/backups/README.md."
