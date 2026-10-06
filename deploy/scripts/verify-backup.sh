#!/usr/bin/env bash
set -Eeuo pipefail

BACKUP_FILE="${1:?Usage: verify-backup.sh /absolute/path/backup.dump}"
[[ "$BACKUP_FILE" = /* && -f "$BACKUP_FILE" && "$BACKUP_FILE" == *.dump ]] || { echo "An existing absolute .dump path is required" >&2; exit 2; }

CONTAINER="legaldhara-restore-$RANDOM-$$"
PASSWORD="$(openssl rand -hex 24)"
cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD="$PASSWORD" postgres:16-alpine >/dev/null
for _ in $(seq 1 30); do
  docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 2
done
docker exec "$CONTAINER" pg_isready -U postgres >/dev/null
docker exec "$CONTAINER" createdb -U postgres verify_restore
docker cp "$BACKUP_FILE" "$CONTAINER:/tmp/backup.dump" >/dev/null
docker exec "$CONTAINER" pg_restore -U postgres -d verify_restore --no-owner --no-privileges /tmp/backup.dump
docker exec "$CONTAINER" psql -U postgres -d verify_restore -v ON_ERROR_STOP=1 -c 'SELECT 1' >/dev/null
docker exec "$CONTAINER" psql -U postgres -d verify_restore -Atc "SELECT to_regclass('public._prisma_migrations') IS NOT NULL" | grep -qx t
echo "Backup restore verification passed"
