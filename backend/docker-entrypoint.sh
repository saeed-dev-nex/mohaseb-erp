#!/bin/sh
# Container entrypoint: fix data-volume ownership, then drop root.
#
# The image ships an unprivileged "appuser"; the app itself (migrate +
# Daphne) always runs as that user. The entrypoint starts as root only
# long enough to chown the data volume — volumes created by older
# root-run installs would otherwise be unwritable after the switch —
# and then re-executes the serve script as appuser.
set -e

if [ "$(id -u)" = "0" ]; then
    mkdir -p /data/media
    chown -R appuser:appuser /data
    # The app writes a few runtime files next to the code (.secret_key,
    # .db_config.json, logs/): the directory itself must be writable.
    chown appuser:appuser /app
    exec su appuser -s /bin/sh -c 'exec /app/serve.sh'
fi

exec /app/serve.sh
