#!/bin/sh
# All-in-one entrypoint: Redis + worker + API in a single container.
# This is what a one-service free host (e.g. Render free) runs, so there's no
# separate worker service or external Redis to pay for. For a scaled, multi-
# process deploy use docker-compose.yml instead (separate api/worker/redis).
set -e

# Local Redis, ephemeral, with the policy BullMQ needs.
redis-server --daemonize yes --save "" --appendonly no --maxmemory-policy noeviction
# give it a moment to accept connections
until redis-cli ping >/dev/null 2>&1; do sleep 0.3; done
echo "[all-in-one] redis up"

# Worker in the background; API in the foreground (PID 1 = the service).
node src/worker.js &
exec node src/server.js
