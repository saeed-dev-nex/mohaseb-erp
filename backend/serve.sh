#!/bin/sh
# Prepare the database, then serve the ASGI app (HTTP + chat WebSocket).
# Runs as the unprivileged app user (see docker-entrypoint.sh).
set -e

cd "$(dirname "$0")"

python manage.py migrate --noinput
# No administrator is created automatically: on first launch the web
# setup wizard creates the superuser and configures the database.

exec daphne -b 0.0.0.0 -p 8000 core.asgi:application
