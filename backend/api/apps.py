import os
import sys
from pathlib import PurePosixPath

from django.apps import AppConfig
from django.conf import settings


def should_start_backup_scheduler():
    """Only serving processes may start a worker; management commands never do."""
    if not getattr(settings, 'BACKUP_SCHEDULER_ENABLED', True):
        return False
    if os.environ.get('DJANGO_BACKUP_SCHEDULER_ENABLED', 'true').strip().lower() in {
        '0', 'false', 'no', 'off',
    }:
        return False
    argv = sys.argv
    if not argv:
        return False
    executable = PurePosixPath(argv[0].replace('\\', '/').lower())
    if executable.name in {'manage.py', 'django-admin', 'django-admin.exe'}:
        if len(argv) < 2 or argv[1] != 'runserver':
            return False
        return os.environ.get('RUN_MAIN', '').lower() == 'true' or '--noreload' in argv
    # Covers the console script and `python -m daphne` used by our launchers.
    return executable.name in {'daphne', 'daphne.exe', 'daphne-script.py'} or (
        executable.name == '__main__.py' and executable.parent.name == 'daphne'
    )


def _set_sqlite_pragmas(sender, connection, **kwargs):
    """Tune every new SQLite connection for multi-operator LAN use.

    WAL lets readers and a writer work at the same time instead of blocking
    each other; busy_timeout makes a connection wait for a lock instead of
    failing at once with "database is locked"; synchronous=NORMAL is the
    recommended durability/performance balance under WAL.
    """
    if connection.vendor != 'sqlite':
        return
    with connection.cursor() as cursor:
        cursor.execute('PRAGMA journal_mode=WAL;')
        cursor.execute('PRAGMA synchronous=NORMAL;')
        cursor.execute('PRAGMA busy_timeout=30000;')


class ApiConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'api'

    def ready(self):
        from django.db.backends.signals import connection_created

        connection_created.connect(
            _set_sqlite_pragmas, dispatch_uid='api_sqlite_pragmas'
        )
        if not should_start_backup_scheduler():
            return
        # A staged PostgreSQL migration (Settings → پایگاه داده) imports
        # its exported payload exactly once, here, before anything else
        # serves traffic: the launchers have already run migrations
        # against the new empty database, so the tables exist.
        from .db_migration import perform_pending_migration

        perform_pending_migration()
        # Make the effective database visible in every run log: a stray
        # DATABASE_URL in the environment silently outranks the app's
        # own configuration, and the first symptom otherwise is missing
        # data with no explanation anywhere.
        try:
            from .db_migration import current_status

            _db_status = current_status()
            print(
                f"Database: {_db_status['engine']} (source: {_db_status['source']})",
                flush=True,
            )
        except Exception:
            pass
        from .scheduler import start_backup_scheduler

        start_backup_scheduler()
