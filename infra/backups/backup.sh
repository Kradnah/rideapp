#!/usr/bin/env bash
# Backup nocturno de rideapp (13.7, paso 5): volcado de Postgres + documentos de conductores,
# cifrados con `age` ANTES de tocar el disco. La clave privada NO vive en el VPS: con lo que hay
# aquí se puede cifrar, pero no descifrar.
#
# Uso (cron del usuario admin, ver README.md):
#   AGE_RECIPIENTS_FILE=~/.config/rideapp-backup/recipients.txt ./backup.sh
#
# Variables:
#   DB_CONTAINER_FILTER   nombre (o prefijo) del contenedor de Postgres   [rideapp-db]
#   API_CONTAINER_FILTER  nombre (o prefijo) del contenedor del API        [rideapp-api]
#   DB_NAME / DB_USER     base y usuario para pg_dump                       [rideapp / rideapp]
#   BACKUP_DIR            dónde se guardan                                  [~/backups/rideapp]
#   AGE_RECIPIENTS_FILE   claves públicas de age (una por línea)            (obligatoria)
#   KEEP_DAILY / KEEP_WEEKLY  retención                                     [7 / 4]
#   RCLONE_REMOTE         copia fuera del VPS, p. ej. `b2:rideapp-backups`  (opcional)
set -euo pipefail
umask 077

DB_CONTAINER_FILTER="${DB_CONTAINER_FILTER:-rideapp-db}"
API_CONTAINER_FILTER="${API_CONTAINER_FILTER:-rideapp-api}"
DB_NAME="${DB_NAME:-rideapp}"
DB_USER="${DB_USER:-rideapp}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/rideapp}"
KEEP_DAILY="${KEEP_DAILY:-7}"
KEEP_WEEKLY="${KEEP_WEEKLY:-4}"
: "${AGE_RECIPIENTS_FILE:?Define AGE_RECIPIENTS_FILE (claves públicas de age)}"

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }
fail() { log "ERROR: $*" >&2; exit 1; }

command -v age >/dev/null || fail 'falta `age` (apt install age)'
[ -s "$AGE_RECIPIENTS_FILE" ] || fail "no existe o está vacío: $AGE_RECIPIENTS_FILE"

# Dokploy añade un sufijo aleatorio a los servicios: se busca por prefijo.
container() {
  docker ps --filter "name=^$1" --format '{{.Names}}' | head -n 1
}
DB_CONTAINER="$(container "$DB_CONTAINER_FILTER")"
[ -n "$DB_CONTAINER" ] || fail "no hay contenedor de Postgres que empiece por $DB_CONTAINER_FILTER"

STAMP="$(date -u +%Y%m%d-%H%M)"
DAILY="$BACKUP_DIR/daily"
WEEKLY="$BACKUP_DIR/weekly"
mkdir -p "$DAILY" "$WEEKLY"

# 1. Postgres: formato custom (comprimido, restaurable por partes) → age → disco.
#    pipefail hace que un fallo de pg_dump aborte aunque age termine bien.
DB_FILE="$DAILY/rideapp-db-$STAMP.dump.age"
log "Volcando $DB_NAME desde $DB_CONTAINER"
docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc --no-owner \
  | age -R "$AGE_RECIPIENTS_FILE" > "$DB_FILE.part"
mv "$DB_FILE.part" "$DB_FILE"

# 2. Documentos de conductores: ya van cifrados con una clave derivada de FIELD_ENCRYPTION_KEY,
#    pero el tar se cifra igual (nombres y tamaños también son datos).
API_CONTAINER="$(container "$API_CONTAINER_FILTER")"
if [ -n "$API_CONTAINER" ]; then
  FILES_FILE="$DAILY/rideapp-files-$STAMP.tar.age"
  log "Copiando documentos desde $API_CONTAINER"
  docker exec "$API_CONTAINER" tar -C /app/var -cf - storage \
    | age -R "$AGE_RECIPIENTS_FILE" > "$FILES_FILE.part"
  mv "$FILES_FILE.part" "$FILES_FILE"
else
  log "AVISO: no hay contenedor del API ($API_CONTAINER_FILTER*): se omiten los documentos"
fi

# 3. Semanal: el del domingo se conserva aparte (enlace duro, no ocupa el doble).
if [ "$(date -u +%u)" = 7 ]; then
  for f in "$DAILY"/*-"$STAMP".*; do ln -f "$f" "$WEEKLY/"; done
fi

# 4. Retención: los N más recientes de cada tipo (7 diarios y 4 semanales, 13.7).
prune() {
  local dir="$1" keep="$2" kind
  for kind in db files; do
    find "$dir" -maxdepth 1 -name "rideapp-$kind-*" -printf '%T@ %p\n' \
      | sort -rn | tail -n +"$((keep + 1))" | cut -d' ' -f2- | xargs -r rm -f
  done
}
prune "$DAILY" "$KEEP_DAILY"
prune "$WEEKLY" "$KEEP_WEEKLY"

# 5. Fuera del VPS (opcional): si el servidor se pierde, los backups no se pierden con él.
if [ -n "${RCLONE_REMOTE:-}" ]; then
  log "Sincronizando con $RCLONE_REMOTE"
  rclone sync "$BACKUP_DIR" "$RCLONE_REMOTE" --transfers 2
fi

log "OK: $(du -h "$DB_FILE" | cut -f1) de base de datos"
