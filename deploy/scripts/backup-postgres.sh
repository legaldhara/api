#!/usr/bin/env bash
set -Eeuo pipefail

MODE="${1:-daily}"
[[ "$MODE" == "daily" || "$MODE" == "predeploy" ]] || { echo "Usage: backup-postgres.sh [daily|predeploy]" >&2; exit 2; }

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/deploy/compose.production.yml"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/deploy/.env.production}"
BACKUP_ROOT="${BACKUP_DIR:-/var/backups/legaldhara}"
TIMESTAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
TARGET_DIR="$BACKUP_ROOT/$MODE"
TARGET_FILE="$TARGET_DIR/legaldhara-$TIMESTAMP.dump"
TEMP_FILE="$TARGET_FILE.tmp"

[[ -f "$ENV_FILE" ]] || { echo "Missing production environment file: $ENV_FILE" >&2; exit 3; }
install -d -m 0700 "$BACKUP_ROOT" "$BACKUP_ROOT/daily" "$BACKUP_ROOT/weekly" "$BACKUP_ROOT/monthly" "$BACKUP_ROOT/predeploy"
trap 'rm -f "$TEMP_FILE"' EXIT

compose() {
  ENV_FILE="$ENV_FILE" docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

compose ps --status running --services | grep -qx postgres || { echo "PostgreSQL is not running" >&2; exit 4; }
compose exec -T postgres sh -ec 'pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --format=custom --no-owner --no-privileges' > "$TEMP_FILE"
[[ -s "$TEMP_FILE" ]] || { echo "Backup is empty" >&2; exit 5; }
mv "$TEMP_FILE" "$TARGET_FILE"
chmod 0600 "$TARGET_FILE"

if [[ "$MODE" == "daily" && "$(date -u +%u)" == "7" ]]; then
  cp -p "$TARGET_FILE" "$BACKUP_ROOT/weekly/"
fi
if [[ "$MODE" == "daily" && "$(date -u +%d)" == "01" ]]; then
  cp -p "$TARGET_FILE" "$BACKUP_ROOT/monthly/"
fi

find "$BACKUP_ROOT/daily" -type f -name '*.dump' -mtime +7 -delete
find "$BACKUP_ROOT/weekly" -type f -name '*.dump' -mtime +28 -delete
find "$BACKUP_ROOT/monthly" -type f -name '*.dump' -mtime +186 -delete
find "$BACKUP_ROOT/predeploy" -type f -name '*.dump' -mtime +14 -delete
printf '%s\n' "$TARGET_FILE"
