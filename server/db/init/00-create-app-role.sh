#!/bin/sh
set -eu

escaped_user=$(printf "%s" "$APP_DB_USER" | sed 's/"/""/g')
escaped_password=$(printf "%s" "$APP_DB_PASSWORD" | sed "s/'/''/g")

if ! printf "%s" "$APP_DB_USER" | grep -Eq '^[a-z_][a-z0-9_]*$'; then
  echo "APP_DB_USER must be a lowercase PostgreSQL identifier" >&2
  exit 1
fi

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 <<-EOSQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$escaped_user') THEN
      EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT', '$escaped_user', '$escaped_password');
    END IF;
  END
  \$\$;
EOSQL
