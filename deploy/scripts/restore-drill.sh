#!/usr/bin/env sh
set -eu

ENV_FILE="${1:-deploy/.env.production}"
BACKUP_FILE="${2:?Pass the backup dump path as the second argument}"
DRILL_DB="learning_portal_restore_drill"
set -a
. "$ENV_FILE"
set +a
case "$DRILL_DB" in learning_portal_restore_drill) ;; *) exit 2 ;; esac
docker compose --env-file "$ENV_FILE" -f compose.production.yaml cp "$BACKUP_FILE" postgres:/tmp/restore-drill.dump
docker compose --env-file "$ENV_FILE" -f compose.production.yaml exec -T postgres dropdb -U "$POSTGRES_USER" --if-exists "$DRILL_DB"
docker compose --env-file "$ENV_FILE" -f compose.production.yaml exec -T postgres createdb -U "$POSTGRES_USER" "$DRILL_DB"
docker compose --env-file "$ENV_FILE" -f compose.production.yaml exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$DRILL_DB" --no-owner /tmp/restore-drill.dump
docker compose --env-file "$ENV_FILE" -f compose.production.yaml exec -T postgres psql -U "$POSTGRES_USER" -d "$DRILL_DB" -v ON_ERROR_STOP=1 -c 'select count(*) from app.schema_migrations;'
docker compose --env-file "$ENV_FILE" -f compose.production.yaml exec -T postgres dropdb -U "$POSTGRES_USER" "$DRILL_DB"
docker compose --env-file "$ENV_FILE" -f compose.production.yaml exec -T postgres rm -f /tmp/restore-drill.dump
echo "Restore drill completed successfully."
