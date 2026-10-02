#!/bin/sh
# Crea el usuario de la aplicación (no superusuario) y la extensión PostGIS.
# Solo se ejecuta la primera vez que se inicializa el volumen.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname rideapp <<SQL
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE ROLE "$APP_DB_USER" LOGIN PASSWORD '$APP_DB_PASSWORD' NOSUPERUSER NOCREATEROLE CREATEDB;
GRANT ALL ON DATABASE rideapp TO "$APP_DB_USER";
GRANT ALL ON SCHEMA public TO "$APP_DB_USER";
ALTER SCHEMA public OWNER TO "$APP_DB_USER";
SQL
