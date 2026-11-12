"""PostgreSQL migration wizard: config precedence, API and import hook.

The wizard (Settings → پایگاه داده) stages a switch from SQLite to
PostgreSQL through two gitignored artifacts — ``.db_config.json`` and
``.db_migration_pending.json``. These tests pin the boot precedence
(DATABASE_URL > config file > SQLite), the encrypted password round
trip between api.secret_store (write side) and core.db_config (read
side), the superuser-only API, and the first-boot import.
"""

import json
import tempfile
from pathlib import Path
from unittest import mock

from django.contrib.auth.models import User
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient, APITestCase

from api import db_migration
from api.backup_utils import build_backup
from api.models import Customer
from api.secret_store import encrypt_secret
from core.db_config import databases_from_env


class LocalConfigFileTests(SimpleTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def _write_config(self, data):
        (self.base / '.db_config.json').write_text(
            json.dumps(data), encoding='utf-8'
        )

    def _pg_config(self, password):
        return {
            'engine': 'postgresql',
            'host': 'db.local',
            'port': 5433,
            'name': 'shop',
            'user': 'mohaseb',
            'password': password,
        }

    def test_file_config_used_and_password_decrypted(self):
        with override_settings(SECRET_KEY='unit-test-secret'):
            encrypted = encrypt_secret('db-pass-1')
        self._write_config(self._pg_config(encrypted))
        cfg = databases_from_env(
            {}, base_dir=self.base, secret_key='unit-test-secret'
        )['default']
        self.assertEqual(cfg['ENGINE'], 'django.db.backends.postgresql')
        self.assertEqual(cfg['NAME'], 'shop')
        self.assertEqual(cfg['USER'], 'mohaseb')
        self.assertEqual(cfg['HOST'], 'db.local')
        self.assertEqual(cfg['PORT'], 5433)
        self.assertEqual(cfg['PASSWORD'], 'db-pass-1')

    def test_env_url_beats_config_file(self):
        self._write_config(self._pg_config('plain'))
        env = {'DATABASE_URL': 'postgres://user:pass@db.internal:5444/envdb'}
        cfg = databases_from_env(env, base_dir=self.base, secret_key='x')['default']
        self.assertEqual(cfg['NAME'], 'envdb')
        self.assertEqual(cfg['PORT'], 5444)

    def test_corrupt_config_falls_back_to_sqlite(self):
        (self.base / '.db_config.json').write_text('{oops', encoding='utf-8')
        cfg = databases_from_env({}, base_dir=self.base, secret_key='x')['default']
        self.assertEqual(cfg['ENGINE'], 'django.db.backends.sqlite3')

    def test_non_postgres_config_falls_back_to_sqlite(self):
        self._write_config({'engine': 'sqlite', 'name': 'x', 'user': 'y'})
        cfg = databases_from_env({}, base_dir=self.base, secret_key='x')['default']
        self.assertEqual(cfg['ENGINE'], 'django.db.backends.sqlite3')

    def test_rotated_secret_key_yields_empty_password(self):
        with override_settings(SECRET_KEY='original-secret'):
            encrypted = encrypt_secret('db-pass-1')
        self._write_config(self._pg_config(encrypted))
        cfg = databases_from_env(
            {}, base_dir=self.base, secret_key='rotated-secret'
        )['default']
        self.assertEqual(cfg['PASSWORD'], '')


class _TempBaseDirMixin:
    def setUp(self):
        super().setUp()
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self._override = override_settings(BASE_DIR=self.base)
        self._override.enable()

    def tearDown(self):
        self._override.disable()
        self.tmp.cleanup()
        super().tearDown()


class DatabaseConfigApiTests(_TempBaseDirMixin, APITestCase):
    def setUp(self):
        super().setUp()
        self.admin = User.objects.create_superuser(
            username='db-admin', password='x', email=''
        )
        self.plain = User.objects.create_user(username='db-plain', password='x')
        self.client = APIClient()

    def test_status_requires_superuser(self):
        response = self.client.get('/api/database-config/')
        self.assertIn(response.status_code, (401, 403))
        self.client.force_authenticate(self.plain)
        response = self.client.get('/api/database-config/')
        self.assertEqual(response.status_code, 403)

    def test_status_reports_sqlite_default(self):
        self.client.force_authenticate(self.admin)
        response = self.client.get('/api/database-config/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['engine'], 'sqlite')
        self.assertEqual(response.data['source'], 'default')
        self.assertFalse(response.data['pending'])

    def test_connection_to_closed_port_reports_friendly_error(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            '/api/database-config/test_connection/',
            {
                'host': '127.0.0.1',
                'port': 1,
                'name': 'mohaseb',
                'user': 'mohaseb',
                'password': 'secret',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(response.data['ok'])
        self.assertIn('برقرار نشد', response.data['detail'])

    def test_start_migration_stages_encrypted_config_and_pending(self):
        Customer.objects.create(name='مشتری مهاجرت', phone='09120000000')
        self.client.force_authenticate(self.admin)
        with mock.patch.object(
            db_migration, 'test_pg_connection', return_value=(True, '', {'tables': 0})
        ):
            response = self.client.post(
                '/api/database-config/start_migration/',
                {
                    'host': '127.0.0.1',
                    'port': 5432,
                    'name': 'mohaseb',
                    'user': 'mohaseb',
                    'password': 'db-pass-9',
                },
                format='json',
            )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.data['started'])
        self.assertGreaterEqual(response.data['counts']['api.customer'], 1)
        config = json.loads(
            (self.base / '.db_config.json').read_text(encoding='utf-8')
        )
        self.assertEqual(config['engine'], 'postgresql')
        self.assertTrue(config['password'].startswith('enc:v1:'))
        self.assertNotIn('db-pass-9', config['password'])
        self.assertTrue((self.base / '.db_migration_pending.json').exists())
        status = db_migration.current_status()
        self.assertTrue(status['pending'])
        # The running process keeps its engine until restart.
        self.assertEqual(status['engine'], 'sqlite')

    def test_rollback_removes_artifacts(self):
        self.client.force_authenticate(self.admin)
        with mock.patch.object(
            db_migration, 'test_pg_connection', return_value=(True, '', {'tables': 0})
        ):
            db_migration.start_migration(
                {
                    'host': '127.0.0.1',
                    'port': 5432,
                    'name': 'mohaseb',
                    'user': 'mohaseb',
                    'password': 'db-pass-9',
                }
            )
        self.assertTrue((self.base / '.db_config.json').exists())
        response = self.client.post('/api/database-config/rollback/', {}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertFalse((self.base / '.db_config.json').exists())
        self.assertFalse((self.base / '.db_migration_pending.json').exists())

    def test_env_managed_database_disables_wizard(self):
        self.client.force_authenticate(self.admin)
        with mock.patch.dict(
            'os.environ', {'DATABASE_URL': 'postgres://u:p@h:5432/db'}
        ):
            response = self.client.post(
                '/api/database-config/start_migration/',
                {
                    'host': '127.0.0.1',
                    'port': 5432,
                    'name': 'mohaseb',
                    'user': 'mohaseb',
                    'password': 'db-pass-9',
                },
                format='json',
            )
        self.assertEqual(response.status_code, 400)
        self.assertIn('DATABASE_URL', response.data['detail'])


class PendingMigrationHookTests(_TempBaseDirMixin, TestCase):
    def _stage(self, payload):
        (self.base / '.db_config.json').write_text(
            json.dumps(
                {
                    'engine': 'postgresql',
                    'host': '127.0.0.1',
                    'port': 5432,
                    'name': 'mohaseb',
                    'user': 'mohaseb',
                    'password': '',
                    'last_migration': None,
                }
            ),
            encoding='utf-8',
        )
        (self.base / '.db_migration_pending.json').write_text(
            json.dumps({'payload': payload}, ensure_ascii=False, default=str),
            encoding='utf-8',
        )

    def test_no_pending_file_is_a_noop(self):
        db_migration.perform_pending_migration(force=True)  # must not raise

    def test_pending_payload_is_imported_and_result_recorded(self):
        Customer.objects.create(name='مشتری قبل از مهاجرت', phone='09120000000')
        payload = build_backup()
        Customer.objects.all().delete()
        self._stage(payload)
        db_migration.perform_pending_migration(force=True)
        self.assertTrue(
            Customer.objects.filter(name='مشتری قبل از مهاجرت').exists()
        )
        self.assertFalse((self.base / '.db_migration_pending.json').exists())
        config = json.loads(
            (self.base / '.db_config.json').read_text(encoding='utf-8')
        )
        self.assertTrue(config['last_migration']['ok'])
        self.assertGreaterEqual(
            config['last_migration']['counts']['api.customer'], 1
        )

    def test_failed_import_keeps_pending_and_records_error(self):
        self._stage({'format': 'mohaseb-backup-v1', 'fixtures': 'broken'})
        db_migration.perform_pending_migration(force=True)
        self.assertTrue((self.base / '.db_migration_pending.json').exists())
        config = json.loads(
            (self.base / '.db_config.json').read_text(encoding='utf-8')
        )
        self.assertFalse(config['last_migration']['ok'])
        self.assertTrue(config['last_migration']['error'])
