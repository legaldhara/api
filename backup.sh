#!/usr/bin/env bash

# Container name (match with docker-compose project)
DB_CONTAINER="legaldhara-postgres-1"  # run `docker ps` to confirm actual name

# Use values from environment or fallbacks
DB_USER="${POSTGRES_USER:-legaldhara}"
DB_NAME="${POSTGRES_DB:-LegalDhara}"

# Path to save backup (on host)
BACKUP_PATH="/home/ubuntu/db_backup_$(date +%F_%H-%M-%S).sql"

# Run pg_dump from inside the Postgres container
docker exec -t "$DB_CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" > "$BACKUP_PATH"

# Show file info
ls -lh "$BACKUP_PATH"
