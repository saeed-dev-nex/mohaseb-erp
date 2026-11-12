"""Environment-driven database / channel-layer configuration.

Defaults preserve the historical single-machine setup exactly: a local
SQLite file and the in-memory channel layer. Larger shops that run
several operators against one server can opt into PostgreSQL and Redis
purely through environment variables, with no code change:

- ``DATABASE_URL``  e.g. ``postgres://user:pass@db-host:5432/mohaseb``
- ``REDIS_URL``     e.g. ``redis://127.0.0.1:6379/0``

Between the environment and the SQLite default sits one more source:
the app-managed local config file ``backend/.db_config.json``, written
by the in-app PostgreSQL migration wizard (Settings → پایگاه داده).
It lets a non-technical user switch databases without ever touching a
terminal or an environment variable. Precedence: ``DATABASE_URL`` wins
(servers/Docker keep full control), then the local config file, then
the historical SQLite default. The file is gitignored — it carries the
database password, encrypted with the same Fernet derivation as
``api/secret_store`` (SHA-256 of SECRET_KEY, ``enc:v1:`` prefix).

Kept as pure functions of an environ mapping so they can be unit-tested
without reloading Django settings.
"""
import base64
import hashlib
import json
import os
from pathlib import Path

LOCAL_DB_CONFIG_FILENAME = '.db_config.json'
_SECRET_PREFIX = 'enc:v1:'


def local_db_config_path(base_dir):
    return Path(base_dir) / LOCAL_DB_CONFIG_FILENAME


def _decrypt_local_secret(value, secret_key):
    """Mirror of api.secret_store.decrypt_secret for settings-load time.

    core/ cannot import api.secret_store while settings are still being
    built, so the (small, stable) derivation is duplicated here; the
    wizard's write side uses api.secret_store itself, and both must
    agree — a test round-trips a value through both implementations.
    """
    if not value:
        return ''
    value = str(value)
    if not value.startswith(_SECRET_PREFIX):
        return value  # legacy plaintext, same passthrough as secret_store
    if not secret_key:
        return ''
    from cryptography.fernet import Fernet, InvalidToken

    digest = hashlib.sha256(secret_key.encode('utf-8')).digest()
    fernet = Fernet(base64.urlsafe_b64encode(digest))
    try:
        return fernet.decrypt(value[len(_SECRET_PREFIX):].encode('ascii')).decode('utf-8')
    except (InvalidToken, ValueError, UnicodeDecodeError):
        return ''


def databases_from_local_config(base_dir, secret_key=None):
    """DATABASES dict from the wizard's local config file, or None."""
    try:
        raw = json.loads(local_db_config_path(base_dir).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None
    if not isinstance(raw, dict) or raw.get('engine') != 'postgresql':
        return None
    name = str(raw.get('name') or '').strip()
    user = str(raw.get('user') or '').strip()
    if not name or not user:
        return None
    try:
        port = int(raw.get('port') or 5432)
    except (TypeError, ValueError):
        port = 5432
    return {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': name,
            'USER': user,
            'PASSWORD': _decrypt_local_secret(raw.get('password') or '', secret_key),
            'HOST': str(raw.get('host') or 'localhost').strip() or 'localhost',
            'PORT': port,
            'CONN_MAX_AGE': 60,
        }
    }


def databases_from_env(environ=None, base_dir=None, secret_key=None):
    """Return the Django ``DATABASES`` dict for the given environment."""
    environ = os.environ if environ is None else environ
    url = (environ.get('DATABASE_URL') or '').strip()
    if url:
        import dj_database_url

        return {
            'default': dj_database_url.parse(url, conn_max_age=60)
        }
    base_dir = Path(base_dir) if base_dir is not None else Path(__file__).resolve().parent.parent
    local = databases_from_local_config(base_dir, secret_key)
    if local is not None:
        return local
    return {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            # Overridable so containers can put the database on a mounted
            # volume (see docker-compose.yml) without touching the code.
            'NAME': environ.get('DJANGO_DB_PATH', base_dir / 'db.sqlite3'),
            # Wait up to 30s for a locked database before erroring (the
            # per-connection PRAGMA busy_timeout in api/apps.py does the
            # same for connections opened outside this configuration).
            # transaction_mode IMMEDIATE is load-bearing: with the default
            # DEFERRED, two operators saving at the same moment both take
            # read locks first and then deadlock on the write upgrade,
            # which SQLite reports as "database is locked" WITHOUT waiting
            # out the busy timeout — the losing invoice was silently lost
            # (verified: 23 of 24 simultaneous creates failed). BEGIN
            # IMMEDIATE takes the write lock up front, so writers queue on
            # the busy timeout instead of deadlocking.
            'OPTIONS': {'timeout': 30, 'transaction_mode': 'IMMEDIATE'},
        }
    }


def channel_layers_from_env(environ=None):
    """Return the Django ``CHANNEL_LAYERS`` dict for the given environment."""
    environ = os.environ if environ is None else environ
    redis_url = (environ.get('REDIS_URL') or '').strip()
    if redis_url:
        return {
            'default': {
                'BACKEND': 'channels_redis.core.RedisChannelLayer',
                'CONFIG': {'hosts': [redis_url]},
            }
        }
    return {
        'default': {
            'BACKEND': 'channels.layers.InMemoryChannelLayer',
        }
    }
