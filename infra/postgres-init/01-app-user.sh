#!/bin/sh
# Crea el usuario de la aplicación (no superusuario) y las extensiones.
# Solo se ejecuta la primera vez que se inicializa el volumen.
set -eu

# Las extensiones se instalan también en template1: así las bases nuevas (incluida la
# "shadow database" que usa `prisma migrate dev`) ya las traen, porque el usuario de la
# app no es superusuario y no puede crear PostGIS por su cuenta.
for db in template1 rideapp; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" <<SQL
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS citext;
SQL
done

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname rideapp <<SQL
CREATE ROLE "$APP_DB_USER" LOGIN PASSWORD '$APP_DB_PASSWORD' NOSUPERUSER NOCREATEROLE CREATEDB;
GRANT ALL ON DATABASE rideapp TO "$APP_DB_USER";
ALTER SCHEMA public OWNER TO "$APP_DB_USER";
SQL
