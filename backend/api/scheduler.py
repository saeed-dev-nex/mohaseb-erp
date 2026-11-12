"""In-process scheduled database backups for the single-server deployment."""

import errno
import json
import logging
import os
import threading
from contextlib import contextmanager
from datetime import timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)
_backup_lock = threading.Lock()
_startup_lock = threading.Lock()
_scheduler_worker = None
_scheduler_pid = None
BUSINESS_TIMEZONE = ZoneInfo(getattr(settings, 'TIME_ZONE', 'Asia/Tehran'))


def start_backup_scheduler():
    """App registry reloads must not create another worker in this process."""
    global _scheduler_worker, _scheduler_pid
    with _startup_lock:
        pid = os.getpid()
        if _scheduler_pid == pid and _scheduler_worker is not None and _scheduler_worker.is_alive():
            return _scheduler_worker
        worker = threading.Thread(
            target=backup_scheduler_loop, name='mohaseb-auto-backup', daemon=True,
        )
        worker.start()
        _scheduler_worker, _scheduler_pid = worker, pid
        return worker


@contextmanager
def _interprocess_backup_lock():
    """Serialize checks for a shared database, including browser fallbacks.

    Keep the lock file: unlinking it allows two processes to lock different
    inodes. OS-owned locks are released automatically when a process exits.
    """
    db_config = settings.DATABASES['default']
    if (db_config.get('ENGINE') or 'sqlite3').endswith('sqlite3'):
        database = Path(db_config['NAME']).resolve()
        lock_path = database.with_name(database.name + '.backup.lock')
    else:
        # External databases (e.g. PostgreSQL via DATABASE_URL) have no
        # local file to anchor the lock to; keep it beside the project.
        lock_path = Path(settings.BASE_DIR) / '.backup-scheduler.lock'
    descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
    with os.fdopen(descriptor, 'r+b', buffering=0) as lock_file:
        # Windows locks one byte, even when the file was just created.
        if os.fstat(lock_file.fileno()).st_size == 0:
            lock_file.write(b'\0')
        lock_file.seek(0)
        acquired = False
        try:
            try:
                if os.name == 'nt':
                    import msvcrt
                    msvcrt.locking(lock_file.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                acquired = True
            except OSError as error:
                if error.errno not in {errno.EACCES, errno.EAGAIN, errno.EDEADLK}:
                    raise
            yield acquired
        finally:
            if acquired:
                lock_file.seek(0)
                if os.name == 'nt':
                    import msvcrt
                    msvcrt.locking(lock_file.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def run_due_backup():
    """Check under both locks, re-reading config after the process lock is held."""
    with _backup_lock:
        try:
            with _interprocess_backup_lock() as acquired:
                if not acquired:
                    return {'ran': False, 'reason': 'another backup check is running'}
                return _run_due_backup_locked()
        except Exception:
            logger.exception('Scheduled Mohaseb backup check failed')
            return {'ran': False, 'reason': 'backup failed; see server logs'}


def _maybe_encrypt_scheduled_payload(payload, config):
    """Encrypt a scheduled backup with the stored backup passphrase.

    Automatic backups use the same passphrase as cloud copies, so one
    passphrase opens every backup the system produces on its own
    (previously scheduled files stayed plain, which made their restore
    behaviour differ from every other backup kind). Without a stored
    passphrase the file stays plain, as before. An unusable stored
    passphrase (e.g. too short) must never lose the backup itself: log
    loudly and keep the plain file — the cloud-upload step records the
    same problem in ``last_cloud_error`` for the settings UI.
    """
    from .secret_store import decrypt_secret

    passphrase = decrypt_secret(getattr(config, 'cloud_passphrase', '') or '').strip()
    if not passphrase:
        return payload
    from .backup_utils import encrypt_backup

    try:
        envelope = encrypt_backup(payload, passphrase)
    except ValueError:
        logger.exception(
            'Stored backup passphrase unusable; saving the scheduled backup plain'
        )
        return payload
    return json.dumps(envelope, ensure_ascii=False, indent=2)


def _run_due_backup_locked():
    """Use the most recent due slot, catching up once after a missed Monday."""
    from .backup_utils import build_backup
    from .models import BackupConfig

    config = BackupConfig.load()
    if not config.auto_backup or not config.backup_path:
        return {'ran': False, 'reason': 'auto backup disabled or path not set'}
    if config.backup_frequency == 'manual':
        return {'ran': False, 'reason': 'manual backup frequency'}
    if config.backup_frequency not in {'daily', 'weekly'} or not 0 <= config.backup_hour <= 23:
        raise ValueError('Invalid automatic backup schedule')

    now = timezone.localtime(timezone.now(), BUSINESS_TIMEZONE)
    due_at = now.replace(hour=config.backup_hour, minute=0, second=0, microsecond=0)
    if config.backup_frequency == 'weekly':
        due_at -= timedelta(days=now.weekday())
    if now < due_at:
        return {'ran': False, 'reason': 'waiting for scheduled backup time'}
    if config.last_backup_at and config.last_backup_at >= due_at:
        return {'ran': False, 'reason': 'already backed up for this schedule'}
    if not os.path.isdir(config.backup_path):
        logger.error('Scheduled Mohaseb backup destination is unavailable')
        return {'ran': False, 'reason': 'backup destination unavailable'}

    filename = f"mohaseb_backup_{now.strftime('%Y%m%d_%H%M%S_%f')}.json"
    destination = os.path.join(config.backup_path, filename)
    temporary = destination + f'.{os.getpid()}.tmp'
    try:
        backup = build_backup()
        payload = json.dumps(backup, ensure_ascii=False, indent=2, default=str)
        payload = _maybe_encrypt_scheduled_payload(payload, config)
        with open(temporary, 'w', encoding='utf-8') as backup_file:
            backup_file.write(payload)
            backup_file.flush()
            os.fsync(backup_file.fileno())
        os.replace(temporary, destination)
    finally:
        Path(temporary).unlink(missing_ok=True)

    config.last_backup_at = timezone.now()
    config.last_backup_path = destination
    config.save(update_fields=['last_backup_at', 'last_backup_path'])
    logger.info('Scheduled Mohaseb backup completed')
    missing_media_files = backup.get('missing_media_files', [])
    if missing_media_files:
        logger.warning(
            'Scheduled backup completed with %d missing document file(s)',
            len(missing_media_files),
        )
    # Best-effort cloud copy: a cloud failure must never undo the local backup.
    try:
        from .cloud_backup import upload_local_backup
        upload_local_backup(config, destination, filename)
    except Exception:
        logger.exception('Cloud backup upload failed after scheduled backup')
    return {'ran': True, 'saved': True, 'path': destination, 'filename': filename}


def backup_scheduler_loop():
    """Run in the backend process so scheduled backups do not depend on a browser."""
    from django.db import close_old_connections

    while True:
        try:
            close_old_connections()
            run_due_backup()
        except Exception:
            logger.exception('Scheduled Mohaseb backup check failed')
        finally:
            close_old_connections()
        threading.Event().wait(30)
