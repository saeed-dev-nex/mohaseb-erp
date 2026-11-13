"""In-app migration from the local SQLite database to PostgreSQL.

Powers the Settings → پایگاه داده wizard. The user fills a small form
(host / port / database / user / password); this module then:

1. tests the PostgreSQL connection and refuses a non-empty target,
2. exports every record with the proven backup engine
   (``backup_utils.build_backup``),
3. writes two runtime artifacts beside the backend (both gitignored):
   ``.db_config.json`` — the connection config ``core.db_config``
   reads at boot (password Fernet-encrypted via ``secret_store``), and
   ``.db_migration_pending.json`` — the exported payload,
4. on the next serving-process start — after the launcher has run
   migrations against the new, empty PostgreSQL — ``ApiConfig.ready``
   calls :func:`perform_pending_migration`, which imports the payload
   with ``backup_utils.restore_backup`` and records the outcome in the
   config file for the UI to show.

The running process never switches engines mid-flight: until the user
restarts, the app keeps serving from SQLite, and the SQLite file is
never modified by the migration, so rolling back is simply deleting
the two artifacts. ``DATABASE_URL`` keeps precedence over the config
file (see core/db_config.py); the wizard disables itself in that case.
"""

import json
import logging
import os
import re
import secrets
import string
from pathlib import Path

from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)

CONFIG_FILENAME = '.db_config.json'
PENDING_FILENAME = '.db_migration_pending.json'


def config_path():
    return Path(settings.BASE_DIR) / CONFIG_FILENAME


def pending_path():
    return Path(settings.BASE_DIR) / PENDING_FILENAME


def _atomic_write_json(path, data):
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(
        json.dumps(data, ensure_ascii=False, default=str), encoding='utf-8'
    )
    temporary.replace(path)


def read_local_config():
    try:
        data = json.loads(config_path().read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def connection_source():
    """Where the active database config came from: env / file / default."""
    if (os.environ.get('DATABASE_URL') or '').strip():
        return 'env'
    if read_local_config() is not None:
        return 'file'
    return 'default'


def current_status():
    config = settings.DATABASES['default']
    engine = (
        'postgresql'
        if (config.get('ENGINE') or '').endswith('postgresql')
        else 'sqlite'
    )
    status = {
        'engine': engine,
        'source': connection_source(),
        'pending': pending_path().exists(),
        'name': config.get('NAME') if engine == 'postgresql' else None,
        'host': config.get('HOST') if engine == 'postgresql' else None,
    }
    local = read_local_config()
    if local is not None and isinstance(local.get('last_migration'), dict):
        status['last_migration'] = local['last_migration']
    return status


def clean_params(data):
    """Validate the wizard form; raises ValueError with a Persian message."""
    host = str(data.get('host') or 'localhost').strip() or 'localhost'
    name = str(data.get('name') or '').strip()
    user = str(data.get('user') or '').strip()
    password = str(data.get('password') or '')
    try:
        port = int(data.get('port') or 5432)
    except (TypeError, ValueError):
        raise ValueError('پورت باید یک عدد باشد.')
    if not name:
        raise ValueError('نام دیتابیس PostgreSQL الزامی است.')
    if not user:
        raise ValueError('نام کاربری PostgreSQL الزامی است.')
    if not 1 <= port <= 65535:
        raise ValueError('پورت باید بین ۱ تا ۶۵۵۳۵ باشد.')
    return {
        'host': host,
        'port': port,
        'name': name,
        'user': user,
        'password': password,
    }


def _friendly_pg_error(error):
    message = str(error)
    if 'password authentication failed' in message:
        return 'نام کاربری یا رمز PostgreSQL اشتباه است.'
    if 'does not exist' in message and 'database' in message:
        return 'دیتابیسی با این نام وجود ندارد؛ ابتدا آن را در pgAdmin بسازید.'
    if any(
        marker in message
        for marker in (
            'could not connect',
            'Connection refused',
            'connection refused',
            'timeout expired',
            'timed out',
            'Name or service not known',
            'could not translate host name',
        )
    ):
        return (
            'اتصال به PostgreSQL برقرار نشد؛ آدرس و پورت را بررسی کنید و '
            'مطمئن شوید سرویس PostgreSQL روشن است.'
        )
    first_line = message.strip().splitlines()[0] if message.strip() else ''
    return f'اتصال به PostgreSQL برقرار نشد: {first_line[:200]}'


def test_pg_connection(params):
    """Check reachability, credentials and that the target DB is empty.

    Returns ``(ok, error_message, stats)``. An "empty" target has no
    user tables, or only tables with zero rows (e.g. a stray migrate) —
    the import replaces content wholesale, so any existing row would
    clash with the restored primary keys.
    """
    import psycopg

    try:
        connection = psycopg.connect(
            host=params['host'],
            port=params['port'],
            dbname=params['name'],
            user=params['user'],
            password=params['password'],
            connect_timeout=5,
        )
    except Exception as error:  # psycopg.OperationalError and friends
        return False, _friendly_pg_error(error), None
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
            )
            tables = [row[0] for row in cursor.fetchall()]
            total_rows = 0
            for table in tables:
                quoted = '"' + table.replace('"', '""') + '"'
                cursor.execute(f'SELECT COUNT(*) FROM {quoted}')
                total_rows += cursor.fetchone()[0]
    except Exception as error:
        return False, _friendly_pg_error(error), None
    finally:
        connection.close()
    if total_rows > 0:
        return (
            False,
            'دیتابیس مقصد خالی نیست و داده دارد؛ یک دیتابیس خالی تازه '
            'بسازید و آن را انتخاب کنید.',
            None,
        )
    return True, '', {'tables': len(tables)}


def start_migration(params):
    """Export everything and stage the switch; returns backup counts."""
    ok, error, _stats = test_pg_connection(params)
    if not ok:
        raise ValueError(error)
    from .backup_utils import build_backup, validate_backup
    from .secret_store import encrypt_secret

    payload = build_backup()
    counts = validate_backup(payload)
    # Pending payload first: a crash between the two writes leaves an
    # inert pending file (the boot hook only runs on PostgreSQL).
    _atomic_write_json(
        pending_path(),
        {
            'created_at': timezone.now().isoformat(),
            'counts': counts,
            'payload': payload,
        },
    )
    _atomic_write_json(
        config_path(),
        {
            'version': 1,
            'engine': 'postgresql',
            'host': params['host'],
            'port': params['port'],
            'name': params['name'],
            'user': params['user'],
            'password': encrypt_secret(params['password']),
            'last_migration': None,
        },
    )
    return counts


# --- Automatic provisioning (first-run setup wizard) -------------------
#
# The wizard can also CREATE the database and its dedicated user, so a
# first-run install never needs pgAdmin/psql. The flow, designed so the
# powerful credential never becomes the running configuration:
#
# * the server-admin credential (usually ``postgres``) is used for this
#   one request only, in memory — it is never stored, logged or echoed;
# * the application gets its OWN least-privilege role (plain LOGIN, no
#   SUPERUSER/CREATEDB) that owns only its own database;
# * the application password is generated here with ``secrets`` and is
#   persisted only Fernet-encrypted inside ``.db_config.json`` (via
#   start_migration) — it is never shown to anyone, not even the person
#   running the wizard;
# * nothing destructive: an existing database or role is refused, and
#   if staging fails after creation, what was created is dropped again.

_IDENTIFIER_RE = re.compile(r'^[A-Za-z_][A-Za-z0-9_]{0,62}$')
_PASSWORD_ALPHABET = string.ascii_letters + string.digits


def clean_admin_params(data):
    """Validate the automatic-provisioning form; ValueError in Persian.

    Database and user names become DDL identifiers, which cannot be
    bound as query parameters — hence the strict whitelist: letters,
    digits and underscore, never starting with a digit. Only names
    passing it are ever interpolated (quoted) into CREATE statements.
    """
    host = str(data.get('host') or 'localhost').strip() or 'localhost'
    try:
        port = int(data.get('port') or 5432)
    except (TypeError, ValueError):
        raise ValueError('پورت باید یک عدد باشد.')
    if not 1 <= port <= 65535:
        raise ValueError('پورت باید بین ۱ تا ۶۵۵۳۵ باشد.')
    admin_user = str(data.get('admin_user') or 'postgres').strip()
    if not admin_user:
        raise ValueError('نام کاربری مدیر PostgreSQL الزامی است.')
    admin_password = str(data.get('admin_password') or '')
    if not admin_password:
        raise ValueError('رمز مدیر PostgreSQL الزامی است.')
    name = str(data.get('name') or '').strip()
    if not _IDENTIFIER_RE.match(name):
        raise ValueError(
            'نام دیتابیس فقط می‌تواند شامل حروف لاتین، عدد و _ باشد و '
            'باید با حرف یا _ شروع شود.'
        )
    user = str(data.get('user') or name).strip()
    if not _IDENTIFIER_RE.match(user):
        raise ValueError(
            'نام کاربر دیتابیس فقط می‌تواند شامل حروف لاتین، عدد و _ '
            'باشد و باید با حرف یا _ شروع شود.'
        )
    return {
        'host': host,
        'port': port,
        'admin_user': admin_user,
        'admin_password': admin_password,
        'name': name,
        'user': user,
    }


def _generate_app_password():
    # Letters and digits only: the value is interpolated as a quoted
    # literal into CREATE USER, and this alphabet contains no character
    # that could terminate or escape the literal.
    return ''.join(secrets.choice(_PASSWORD_ALPHABET) for _ in range(32))


def _quoted_identifier(value):
    # Values reaching here already passed _IDENTIFIER_RE (no quote
    # characters possible); quoting is defence in depth.
    return '"' + value.replace('"', '""') + '"'


def _admin_connect(admin_params, dbname='postgres'):
    import psycopg

    return psycopg.connect(
        host=admin_params['host'],
        port=admin_params['port'],
        dbname=dbname,
        user=admin_params['admin_user'],
        password=admin_params['admin_password'],
        connect_timeout=5,
        autocommit=True,  # CREATE DATABASE cannot run in a transaction
    )


def provision_database(admin_params):
    """Create the app role + database; returns the app connection params.

    Raises ValueError with a Persian message. Refuses (creating
    nothing) when the database or role already exists, and rolls back
    its own creations if a later step fails, so a retry never trips
    over orphans whose generated password nobody knows.
    """
    try:
        connection = _admin_connect(admin_params)
    except Exception as error:
        raise ValueError(_friendly_pg_error(error))
    app_password = _generate_app_password()
    created_user = False
    created_db = False
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                'SELECT 1 FROM pg_database WHERE datname = %s',
                [admin_params['name']],
            )
            if cursor.fetchone():
                raise ValueError(
                    'دیتابیسی با این نام از قبل روی سرور وجود دارد؛ نام '
                    'دیگری انتخاب کنید یا حالت «دیتابیس آماده» را به کار '
                    'ببرید.'
                )
            cursor.execute(
                'SELECT 1 FROM pg_roles WHERE rolname = %s',
                [admin_params['user']],
            )
            if cursor.fetchone():
                raise ValueError(
                    'کاربری با این نام از قبل روی سرور وجود دارد؛ نام '
                    'دیگری انتخاب کنید یا حالت «دیتابیس آماده» را به کار '
                    'ببرید.'
                )
            cursor.execute(
                f'CREATE USER {_quoted_identifier(admin_params["user"])} '
                f"WITH LOGIN PASSWORD '{app_password}'"
            )
            created_user = True
            cursor.execute(
                f'CREATE DATABASE {_quoted_identifier(admin_params["name"])} '
                f'OWNER {_quoted_identifier(admin_params["user"])}'
            )
            created_db = True
    except ValueError:
        connection.close()
        raise
    except Exception as error:
        try:
            with connection.cursor() as cursor:
                if created_db:
                    cursor.execute(
                        f'DROP DATABASE IF EXISTS '
                        f'{_quoted_identifier(admin_params["name"])}'
                    )
                if created_user:
                    cursor.execute(
                        f'DROP USER IF EXISTS '
                        f'{_quoted_identifier(admin_params["user"])}'
                    )
        except Exception:
            logger.warning('Provisioning rollback incomplete', exc_info=True)
        connection.close()
        raise ValueError(_friendly_pg_error(error))
    connection.close()
    app_params = {
        'host': admin_params['host'],
        'port': admin_params['port'],
        'name': admin_params['name'],
        'user': admin_params['user'],
        'password': app_password,
    }
    ok, error, _stats = test_pg_connection(app_params)
    if not ok:
        _drop_provisioned(admin_params)
        raise ValueError(error)
    return app_params


def _drop_provisioned(admin_params):
    """Best-effort removal of what provision_database created."""
    try:
        connection = _admin_connect(admin_params)
    except Exception:
        logger.warning('Could not reconnect to drop provisioned database', exc_info=True)
        return
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                f'DROP DATABASE IF EXISTS {_quoted_identifier(admin_params["name"])}'
            )
            cursor.execute(
                f'DROP USER IF EXISTS {_quoted_identifier(admin_params["user"])}'
            )
    except Exception:
        logger.warning('Dropping provisioned database failed', exc_info=True)
    finally:
        connection.close()


def provision_and_stage(admin_params):
    """Provision, then stage the switch exactly like a manual target.

    If staging fails, the fresh database and role are dropped again:
    their generated password exists only inside the staged config, so
    leaving them behind would strand an unreachable database.
    """
    app_params = provision_database(admin_params)
    try:
        return start_migration(app_params)
    except ValueError:
        _drop_provisioned(admin_params)
        raise
    except Exception:
        _drop_provisioned(admin_params)
        logger.exception('Staging after provisioning failed')
        raise ValueError(
            'ذخیرهٔ تنظیمات دیتابیس ناموفق بود و دیتابیس ساخته‌شده پاک '
            'شد؛ دوباره تلاش کنید.'
        )


def cancel_or_rollback():
    """Drop the staged/active local config; the next start uses SQLite."""
    pending_path().unlink(missing_ok=True)
    config_path().unlink(missing_ok=True)


def _record_result(ok, counts, error):
    config = read_local_config()
    if config is None:
        return
    config['last_migration'] = {
        'ok': ok,
        'at': timezone.now().isoformat(),
        'counts': counts,
        'error': error,
    }
    _atomic_write_json(config_path(), config)


def perform_pending_migration(force=False):
    """Import a staged payload; called from ApiConfig.ready at startup.

    Runs only in a serving process whose default database is the
    PostgreSQL named by the local config (``force`` exists for tests).
    Failures are recorded for the UI and the pending file is kept, so
    the next start retries instead of losing the export.
    """
    if not pending_path().exists():
        return
    engine = settings.DATABASES['default'].get('ENGINE') or ''
    if not force and not engine.endswith('postgresql'):
        return
    if not force:
        # The payload belongs in the database the local config names.
        # If the environment has since pointed the app at a DIFFERENT
        # PostgreSQL (e.g. a DATABASE_URL leaked from another install),
        # importing here would restore the data into the wrong database
        # — refuse, keep the pending file, and say why.
        config = read_local_config()
        if config is not None:
            target_name = str(config.get('name') or '')
            active_name = str(settings.DATABASES['default'].get('NAME') or '')
            if target_name and active_name != target_name:
                logger.warning(
                    'Pending migration targets database %r but the active '
                    'database is %r; import skipped.',
                    target_name, active_name,
                )
                _record_result(
                    False, None,
                    'پایگاه دادهٔ فعال با مقصد مهاجرت همخوان نیست؛ واردسازی انجام نشد.',
                )
                return
    try:
        pending = json.loads(pending_path().read_text(encoding='utf-8'))
        from .backup_utils import restore_backup

        counts = restore_backup(pending['payload'])
    except Exception as error:
        logger.exception('Pending PostgreSQL migration failed')
        _record_result(False, None, str(error)[:500])
        return
    _record_result(True, counts, '')
    pending_path().unlink(missing_ok=True)
    logger.info('PostgreSQL migration import completed: %s', counts)
