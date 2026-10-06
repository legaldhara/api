#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

bash -n deploy/scripts/*.sh
ENV_FILE=.env.production.example docker compose --env-file deploy/.env.production.example -f deploy/compose.production.yml config --quiet
docker run --rm -e API_DOMAIN=api.legaldhara.com -e ACME_EMAIL=ops@legaldhara.com \
  -v "$REPO_ROOT/deploy/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2-alpine caddy adapt --config /etc/caddy/Caddyfile >/dev/null
