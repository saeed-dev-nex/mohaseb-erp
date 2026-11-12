#!/bin/sh
# Prepare the database, then serve the ASGI app (HTTP + chat WebSocket).
set -e

python manage.py migrate --noinput
# No administrator is created automatically: on first launch the web
# setup wizard creates the superuser and configures the database.

exec daphne -b 0.0.0.0 -p 8000 core.asgi:application
