"""Scheduler regressions using synthetic config/payloads and temporary files only."""

import json
import os
import subprocess
import sys
from datetime import datetime, timezone as datetime_timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.apps import apps
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient

from api import scheduler
from api.apps import should_start_backup_scheduler


@override_settings(BACKUP_SCHEDULER_ENABLED=True)
class SchedulerStartupTests(SimpleTestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {'DJANGO_BACKUP_SCHEDULER_ENABLED': 'true'})
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def test_actual_daphne_entrypoints_start_worker(self):
        entries = [
            '/usr/local/bin/daphne',
            r'C:\app\.venv\Scripts\daphne.exe',
            r'C:\app\.venv\Lib\site-packages\daphne\__main__.py',
            '/app/.venv/lib/python3.12/site-packages/daphne/__main__.py',
        ]
        for entry in entries:
            with self.subTest(entry=entry), patch.object(sys, 'argv', [entry, '-b', '0.0.0.0', 'core.asgi:application']):
                with patch('api.scheduler.start_backup_scheduler') as start:
                    apps.get_app_config('api').ready()
                start.assert_called_once_with()

    def test_management_commands_never_start_even_with_reloader_flag(self):
        for command in ['test', 'check', 'migrate', 'makemigrations', 'shell', 'ensure_admin', 'collectstatic']:
            with self.subTest(command=command), patch.object(sys, 'argv', ['manage.py', command]):
                with patch.dict(os.environ, {'RUN_MAIN': 'true'}), patch('api.scheduler.start_backup_scheduler') as start:
                    apps.get_app_config('api').ready()
                start.assert_not_called()

    def test_only_runserver_child_or_noreload_starts(self):
        cases = [('', [], False), ('true', [], True), ('', ['--noreload'], True)]
        for run_main, extra, expected in cases:
            with self.subTest(run_main=run_main, extra=extra):
                with patch.object(sys, 'argv', ['manage.py', 'runserver', *extra]), patch.dict(os.environ, {'RUN_MAIN': run_main}):
                    self.assertEqual(should_start_backup_scheduler(), expected)

    def test_tests_can_disable_startup_with_setting_or_environment(self):
        with patch.object(sys, 'argv', ['daphne', 'core.asgi:application']):
            with override_settings(BACKUP_SCHEDULER_ENABLED=False):
                self.assertFalse(should_start_backup_scheduler())
            with patch.dict(os.environ, {'DJANGO_BACKUP_SCHEDULER_ENABLED': 'off'}):
                self.assertFalse(should_start_backup_scheduler())

    def test_other_python_entrypoints_do_not_start(self):
        for argv in [[], ['-c'], ['pytest'], ['other/__main__.py']]:
            with self.subTest(argv=argv), patch.object(sys, 'argv', argv):
                self.assertFalse(should_start_backup_scheduler())

    def test_repeated_startup_creates_only_one_worker_per_process(self):
        with patch.object(scheduler, '_scheduler_worker', None), patch.object(scheduler, '_scheduler_pid', None):
            with patch('api.scheduler.threading.Thread') as thread:
                thread.return_value.is_alive.return_value = True
                first = scheduler.start_backup_scheduler()
                second = scheduler.start_backup_scheduler()
                self.assertIs(first, second)
                thread.assert_called_once_with(
                    target=scheduler.backup_scheduler_loop,
                    name='mohaseb-auto-backup', daemon=True,
                )
                thread.return_value.start.assert_called_once_with()


@override_settings(TIME_ZONE='UTC')
class DueBackupTests(SimpleTestCase):
    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.directory = Path(directory.name)
        self.config = SimpleNamespace(
            auto_backup=True, backup_path=str(self.directory), backup_frequency='daily',
            backup_hour=13, last_backup_at=None, last_backup_path='', save=Mock(),
        )
        # Never access an actual database or real backup payload.
        load = patch('api.models.BackupConfig.load', return_value=self.config)
        self.load = load.start()
        self.addCleanup(load.stop)
        build = patch('api.backup_utils.build_backup', return_value={
            'format': 'mohaseb-backup-v1', 'fixtures': [], 'synthetic': True,
        })
        self.build = build.start()
        self.addCleanup(build.stop)
        settings_patch = patch.object(scheduler, 'settings', SimpleNamespace(DATABASES={
            'default': {'NAME': str(self.directory / 'synthetic.sqlite3')},
        }))
        settings_patch.start()
        self.addCleanup(settings_patch.stop)

    def run_at(self, iso):
        now = datetime.fromisoformat(iso)
        with patch('api.scheduler.timezone.now', return_value=now):
            return scheduler.run_due_backup()

    def test_daily_schedule_uses_tehran_hour_even_with_utc_settings(self):
        self.assertFalse(self.run_at('2026-10-19T09:29:59+00:00')['ran'])
        self.build.assert_not_called()
        result = self.run_at('2026-10-19T09:30:00+00:00')
        self.assertTrue(result['ran'])
        self.assertIn('20261019_130000', result['filename'])
        payload = json.loads(Path(result['path']).read_text(encoding='utf-8'))
        self.assertEqual(payload, {'format': 'mohaseb-backup-v1', 'fixtures': [], 'synthetic': True})
        self.config.save.assert_called_once_with(update_fields=['last_backup_at', 'last_backup_path'])
        self.assertFalse(self.run_at('2026-10-19T20:00:00+00:00')['ran'])
        self.assertTrue(self.run_at('2026-10-20T09:30:00+00:00')['ran'])
        self.assertEqual(self.build.call_count, 2)

    def test_tehran_calendar_day_not_utc_date_controls_duplicate_check(self):
        self.config.backup_hour = 0
        self.config.last_backup_at = datetime(2026, 10, 18, 20, 0, tzinfo=datetime_timezone.utc)
        self.assertTrue(self.run_at('2026-10-18T20:30:00+00:00')['ran'])
        self.assertFalse(self.run_at('2026-10-19T00:00:00+00:00')['ran'])

    def test_weekly_waits_until_monday_hour_and_runs_only_once(self):
        self.config.backup_frequency = 'weekly'
        self.assertFalse(self.run_at('2026-10-19T09:29:59+00:00')['ran'])
        self.assertTrue(self.run_at('2026-10-19T09:30:00+00:00')['ran'])
        self.assertFalse(self.run_at('2026-10-25T12:00:00+00:00')['ran'])
        self.assertTrue(self.run_at('2026-10-26T09:30:00+00:00')['ran'])

    def test_missed_monday_catches_up_on_restart_before_tuesday_hour(self):
        self.config.backup_frequency = 'weekly'
        self.config.last_backup_at = datetime.fromisoformat('2026-10-12T10:00:00+00:00')
        self.assertTrue(self.run_at('2026-10-20T05:00:00+00:00')['ran'])
        self.assertFalse(self.run_at('2026-10-20T12:00:00+00:00')['ran'])
        self.assertFalse(self.run_at('2026-10-25T12:00:00+00:00')['ran'])
        self.build.assert_called_once_with()

    def test_long_downtime_catches_up_once_instead_of_replaying_weeks(self):
        self.config.backup_frequency = 'weekly'
        self.config.last_backup_at = datetime.fromisoformat('2026-09-01T10:00:00+00:00')
        self.assertTrue(self.run_at('2026-10-25T12:00:00+00:00')['ran'])
        self.assertFalse(self.run_at('2026-10-25T13:00:00+00:00')['ran'])
        self.build.assert_called_once_with()

    def test_disabled_manual_and_missing_destination_do_not_build(self):
        for field, value in [('auto_backup', False), ('backup_frequency', 'manual'), ('backup_path', '')]:
            with self.subTest(field=field):
                original = getattr(self.config, field)
                setattr(self.config, field, value)
                self.assertFalse(self.run_at('2026-10-19T12:00:00+00:00')['ran'])
                setattr(self.config, field, original)
        self.config.backup_path = str(self.directory / 'not-created')
        with self.assertLogs('api.scheduler', level='ERROR'):
            self.assertFalse(self.run_at('2026-10-19T12:00:00+00:00')['ran'])
        self.build.assert_not_called()

    def test_file_replace_failure_is_logged_sanitized_and_retryable(self):
        with patch('api.scheduler.os.replace', side_effect=OSError('private-server-path')):
            with self.assertLogs('api.scheduler', level='ERROR'):
                result = self.run_at('2026-10-19T12:00:00+00:00')
        self.assertFalse(result['ran'])
        self.assertNotIn('private-server-path', str(result))
        self.assertEqual(list(self.directory.glob('*.tmp')), [])
        self.assertEqual(list(self.directory.glob('*.json')), [])
        self.config.save.assert_not_called()
        self.assertTrue(self.run_at('2026-10-19T12:00:00+00:00')['ran'])

    def test_payload_failure_is_logged_and_does_not_mark_backup_complete(self):
        self.build.side_effect = RuntimeError('synthetic payload failure')
        with self.assertLogs('api.scheduler', level='ERROR'):
            self.assertFalse(self.run_at('2026-10-19T12:00:00+00:00')['ran'])
        self.config.save.assert_not_called()

    def test_held_process_lock_prevents_even_loading_config(self):
        with scheduler._interprocess_backup_lock() as acquired:
            self.assertTrue(acquired)
            result = self.run_at('2026-10-19T12:00:00+00:00')
        self.assertFalse(result['ran'])
        self.load.assert_not_called()
        self.build.assert_not_called()
        self.assertTrue(self.run_at('2026-10-19T12:00:00+00:00')['ran'])

    def test_next_process_check_reloads_persisted_completion_under_lock(self):
        first = self.run_at('2026-10-19T12:00:00+00:00')
        self.assertTrue(first['ran'])
        persisted = SimpleNamespace(**vars(self.config))
        self.load.return_value = persisted
        self.assertFalse(self.run_at('2026-10-19T12:01:00+00:00')['ran'])
        self.assertEqual(self.load.call_count, 2)
        self.build.assert_called_once_with()


class CrossProcessBackupLockTests(SimpleTestCase):
    def test_lock_excludes_other_process_and_recovers_after_process_exit(self):
        # The child configures settings explicitly: no django.setup(), no
        # application worker, migrations, or connection to any database.
        code = (
            'import os, sys; from django.conf import settings; '
            'settings.configure(DATABASES={"default": {"NAME": sys.argv[1]}}); '
            'from api.scheduler import _interprocess_backup_lock; '
            'lock = _interprocess_backup_lock(); acquired = lock.__enter__(); '
            'print(acquired, flush=True); '
            'os._exit(0)'
        )
        with TemporaryDirectory() as directory:
            database = str(Path(directory) / 'synthetic.sqlite3')
            with patch.object(scheduler, 'settings', SimpleNamespace(DATABASES={'default': {'NAME': database}})):
                def probe():
                    result = subprocess.run(
                        [sys.executable, '-c', code, database],
                        cwd=Path(__file__).resolve().parents[2],
                        capture_output=True, text=True, timeout=30,
                    )
                    self.assertEqual(result.returncode, 0, result.stderr)
                    return result.stdout.strip()

                with scheduler._interprocess_backup_lock() as acquired:
                    self.assertTrue(acquired)
                    self.assertEqual(probe(), 'False')
                self.assertEqual(probe(), 'True')
                # The child exited without unlocking; OS cleanup permits retry.
                with scheduler._interprocess_backup_lock() as acquired:
                    self.assertTrue(acquired)
                self.assertFalse(Path(database).exists())
                self.assertTrue(Path(database + '.backup.lock').exists())


class AutoBackupEndpointTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()
        self.url = '/api/backup-config/check_auto/'

    def user(self, superuser=False, staff=False):
        return SimpleNamespace(is_authenticated=True, is_active=True, is_superuser=superuser, is_staff=staff)

    def test_anonymous_and_non_superusers_cannot_trigger_scheduler(self):
        with patch('api.scheduler.run_due_backup') as run:
            self.assertIn(self.client.post(self.url).status_code, (401, 403))
            for user in [self.user(), self.user(staff=True)]:
                self.client.force_authenticate(user=user)
                self.assertEqual(self.client.post(self.url).status_code, 403)
            run.assert_not_called()

    def test_superuser_get_is_method_not_allowed_and_has_no_side_effect(self):
        self.client.force_authenticate(user=self.user(superuser=True))
        with patch('api.scheduler.run_due_backup') as run:
            self.assertEqual(self.client.get(self.url).status_code, 405)
            run.assert_not_called()

    def test_superuser_post_returns_only_public_status(self):
        self.client.force_authenticate(user=self.user(superuser=True))
        with patch('api.scheduler.run_due_backup', return_value={
            'ran': True, 'saved': True, 'path': '/private/server/backup.json',
            'filename': 'backup.json', 'reason': 'internal diagnostic',
        }) as run:
            response = self.client.post(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'ran': True, 'saved': True})
        run.assert_called_once_with()


class SchedulerLoopTests(SimpleTestCase):
    def test_loop_logs_failure_closes_connections_and_waits_before_retry(self):
        with patch('django.db.close_old_connections') as close, patch('api.scheduler.run_due_backup', side_effect=RuntimeError('synthetic failure')):
            with patch('api.scheduler.threading.Event') as event:
                event.return_value.wait.side_effect = StopIteration
                with self.assertLogs('api.scheduler', level='ERROR'):
                    with self.assertRaises(StopIteration):
                        scheduler.backup_scheduler_loop()
                event.return_value.wait.assert_called_once_with(30)
        self.assertEqual(close.call_count, 2)
