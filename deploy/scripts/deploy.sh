#!/usr/bin/env bash
set -Eeuo pipefail

DEPLOY_SHA="${1:?Usage: deploy.sh <40-character-commit-sha>}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "Invalid commit SHA" >&2; exit 2; }
exec 9>/var/lock/legaldhara-deploy.lock
flock -n 9 || { echo "Another deployment is active" >&2; exit 3; }

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/deploy/compose.production.yml"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/deploy/.env.production}"
[[ -f "$ENV_FILE" ]] || { echo "Missing production environment file: $ENV_FILE" >&2; exit 4; }

compose() {
  ENV_FILE="$ENV_FILE" docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

wait_for_internal_health() {
  for _ in $(seq 1 30); do
    if compose exec -T api node -e "fetch('http://127.0.0.1:4001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
      return 0
    fi
    sleep 5
  done
  return 1
}

wait_for_public_health() {
  for _ in $(seq 1 30); do
    if curl --fail --silent --show-error "https://$API_DOMAIN/health" >/dev/null; then
      return 0
    fi
    sleep 5
  done
  return 1
}

cd "$REPO_ROOT"
PREVIOUS_SHA="$(git rev-parse HEAD)"
DEPLOY_PHASE="preflight"
CADDY_WAS_RUNNING=false
BACKUP_FILE=""

handle_failure() {
  local exit_code=$?
  trap - ERR
  set +e
  echo "Deployment failed during phase: $DEPLOY_PHASE" >&2
  compose logs --tail 200 api caddy >&2

  if [[ "$DEPLOY_PHASE" == "migration_started" || "$DEPLOY_PHASE" == "api_started" || "$DEPLOY_PHASE" == "public_health" ]]; then
    compose stop caddy
    echo "Database migrations may have been applied. Public API traffic remains stopped." >&2
    echo "Do not start the previous API against the migrated database." >&2
    echo "Inspect the new API logs and either fix forward or restore this backup before restoring previous images:" >&2
    echo "$BACKUP_FILE" >&2
  else
    git checkout --detach "$PREVIOUS_SHA"
    if [[ "$CADDY_WAS_RUNNING" == true ]]; then
      compose start caddy
    fi
    echo "No migration was started; the previous deployment remains active." >&2
  fi
  exit "$exit_code"
}
trap handle_failure ERR

git fetch --no-tags origin "$DEPLOY_SHA"
git cat-file -e "$DEPLOY_SHA^{commit}"
git checkout --detach "$DEPLOY_SHA"
export IMAGE_TAG="$DEPLOY_SHA"
compose config --quiet
compose build api migrate
compose up -d postgres

if compose ps --status running --services | grep -qx caddy; then
  CADDY_WAS_RUNNING=true
  compose stop caddy
fi
DEPLOY_PHASE="traffic_paused"

BACKUP_FILE="$(ENV_FILE="$ENV_FILE" "$SCRIPT_DIR/backup-postgres.sh" predeploy)"
"$SCRIPT_DIR/verify-backup.sh" "$BACKUP_FILE"

DEPLOY_PHASE="migration_started"
compose run --rm migrate

DEPLOY_PHASE="api_started"
compose up -d api
wait_for_internal_health

DEPLOY_PHASE="public_health"
compose up -d caddy
API_DOMAIN="${API_DOMAIN:-api.legaldhara.com}"
wait_for_public_health

DEPLOY_PHASE="complete"
trap - ERR
echo "Deployment completed successfully: $DEPLOY_SHA"
echo "Verified backup: $BACKUP_FILE"
