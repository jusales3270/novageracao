#!/bin/sh
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    DO \$\$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ng_app') THEN
        CREATE ROLE ng_app WITH LOGIN PASSWORD '${DB_SENHA_APP:-ng_app_senha}';
      END IF;
    END
    \$\$;
EOSQL
