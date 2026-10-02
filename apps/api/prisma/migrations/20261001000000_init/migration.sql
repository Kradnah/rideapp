-- Extensiones base (7.5, paso 3).
-- PostGIS no es una extensión "trusted": la primera vez debe crearla un superusuario.
-- En local la crea infra/postgres-init; en Dokploy, ver docs/security.md.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS citext;
