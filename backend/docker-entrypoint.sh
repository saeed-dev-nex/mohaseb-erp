#!/bin/sh
# Prepare the database, then serve the ASGI app (HTTP + chat WebSocket).
set -e

python manage.py migrate --noinput
# Creates the first superuser only when none exists; the initial password is
# printed to the container log exactly once — read it with `docker compose logs backend`.
python manage.py ensure_admin || true

exec daphne -b 0.0.0.0 -p 8000 core.asgi:application
