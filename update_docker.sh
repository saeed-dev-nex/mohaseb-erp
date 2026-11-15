#!/bin/sh
# Mohaseb ERP - one-command Docker update (run on the HOST).
# Pulls the latest code, rebuilds the images and restarts the
# services; the app is back on its own when the health check passes.
set -e
cd "$(dirname "$0")"

echo "[1/3] Receiving the latest code..."
git pull

echo "[2/3] Rebuilding and restarting the services..."
docker compose up -d --build

echo "[3/3] Waiting for the app to come back..."
for i in $(seq 1 60); do
  if curl -sf -o /dev/null "http://localhost:8000/api/setup/status/"; then
    echo "Update done - the app is up."
    exit 0
  fi
  sleep 3
done
echo "The services are still starting; check 'docker compose logs -f backend' and open the app in a minute."
