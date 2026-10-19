#!/bin/bash
set -eu

: "${APP_DATABASE_USER:?APP_DATABASE_USER must be configured}"
: "${APP_DATABASE_PASSWORD:?APP_DATABASE_PASSWORD must be configured}"

psql --set=ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=app_user="$APP_DATABASE_USER" \
  --set=app_password="$APP_DATABASE_PASSWORD" \
  --set=app_db="$POSTGRES_DB" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_password') \gexec
GRANT CONNECT ON DATABASE :"app_db" TO :"app_user";
GRANT USAGE, CREATE ON SCHEMA public TO :"app_user";
ALTER SCHEMA public OWNER TO :"app_user";
SQL
