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

cd "$REPO_ROOT"
PREVIOUS_SHA="$(git rev-parse HEAD)"
git fetch --no-tags origin "$DEPLOY_SHA"
git cat-file -e "$DEPLOY_SHA^{commit}"

if compose ps --status running --services | grep -qx postgres; then
  ENV_FILE="$ENV_FILE" "$SCRIPT_DIR/backup-postgres.sh" predeploy
fi

git checkout --detach "$DEPLOY_SHA"
export IMAGE_TAG="$DEPLOY_SHA"
compose config --quiet
compose build api migrate
compose up -d postgres
compose run --rm migrate
compose up -d api caddy

API_DOMAIN="${API_DOMAIN:-api.legaldhara.com}"
for _ in $(seq 1 30); do
  curl --fail --silent --show-error "https://$API_DOMAIN/health" >/dev/null && exit 0
  sleep 5
done

compose logs --tail 200 api caddy >&2 || true
git checkout --detach "$PREVIOUS_SHA"
export IMAGE_TAG="$PREVIOUS_SHA"
compose up -d api caddy
echo "Deployment failed health checks; previous API image restored" >&2
exit 5
