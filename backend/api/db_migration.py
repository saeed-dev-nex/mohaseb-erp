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
