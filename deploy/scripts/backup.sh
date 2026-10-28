#!/usr/bin/env sh
set -eu

ENV_FILE="${1:-deploy/.env.production}"
BACKUP_DIR="${BACKUP_DIR:-backups}"
mkdir -p "$BACKUP_DIR"
set -a
. "$ENV_FILE"
set +a
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="$BACKUP_DIR/learning-portal-$STAMP.dump"
docker compose --env-file "$ENV_FILE" -f compose.production.yaml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --file=/tmp/backup.dump
docker compose --env-file "$ENV_FILE" -f compose.production.yaml exec -T postgres pg_restore --list /tmp/backup.dump >/dev/null
docker compose --env-file "$ENV_FILE" -f compose.production.yaml cp postgres:/tmp/backup.dump "$TARGET"
docker compose --env-file "$ENV_FILE" -f compose.production.yaml exec -T postgres rm -f /tmp/backup.dump
find "$BACKUP_DIR" -type f -name 'learning-portal-*.dump' -mtime "+${BACKUP_RETENTION_DAYS:-14}" -delete
echo "Verified backup created: $TARGET"
