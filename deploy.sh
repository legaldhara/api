#!/bin/bash

echo "🚀 Starting Production Deployment..."

# Load .env variables
if [ -f ".env" ]; then
  export $(cat .env | xargs)
fi

# Stop any running containers
docker compose down

# Build and start containers
docker compose up -d --build

# Show running containers
docker ps

echo "✅ Deployment Complete!"
