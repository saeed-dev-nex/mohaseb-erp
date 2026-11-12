"""Backup passphrase unification + restore recovery.

One stored backup passphrase (BackupConfig.cloud_passphrase) now backs
every automatically produced backup: scheduled files are encrypted
with it (previously plain) and cloud copies already were. Restores
try the typed passphrase first and then the stored one, so a backup
opens even when the two were mixed up — or the stored passphrase has
changed since the file was made and the user types the old one.
"""

import json
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase
from rest_framework.test import APITestCase

from .. import scheduler
from ..backup_utils import (
    decrypt_backup,
    decrypt_backup_with_fallbacks,
    encrypt_backup,
    is_encrypted_backup,
)
from ..models import BackupConfig
from ..secret_store import encrypt_secret

User = get_user_model()

STORED = 'stored-pass-22'
TYPED = 'manual-pass-11'


class FallbackHelperTests(SimpleTestCase):
    def setUp(self):
        self.envelope = encrypt_backup(json.dumps({'format': 'mohaseb-backup-v1'}), STORED)

    def test_first_matching_candidate_wins(self):
        backup, matched = decrypt_backup_with_fallbacks(self.envelope, [TYPED, STORED])
        self.assertEqual(backup['format'], 'mohaseb-backup-v1')
        self.assertEqual(matched, STORED)

    def test_typed_candidate_preferred(self):
        _backup, matched = decrypt_backup_with_fallbacks(self.envelope, [STORED, TYPED])
        self.assertEqual(matched, STORED)

    def test_no_candidates_raises_passphrase_required(self):
        with self.assertRaisesMessage(ValueError, 'وارد کنید'):
            decrypt_backup_with_fallbacks(self.envelope, ['', '  '])

    def test_all_wrong_raises_wrong_passphrase(self):
        with self.assertRaisesMessage(ValueError, 'اشتباه است'):
            decrypt_backup_with_fallbacks(self.envelope, [TYPED])


class ScheduledBackupEncryptionTests(SimpleTestCase):
    """Mirror of the DueBackupTests harness, with a passphrase on the config."""

    def _run(self, cloud_passphrase):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        config = SimpleNamespace(
            auto_backup=True,
            backup_path=str(root),
            backup_frequency='daily',
            backup_hour=13,
            last_backup_at=None,
            last_backup_path='',
            save=Mock(),
            cloud_enabled=False,
            cloud_passphrase=cloud_passphrase,
        )
        patches = [
            patch('api.models.BackupConfig.load', return_value=config),
            patch(
                'api.backup_utils.build_backup',
                return_value={'format': 'mohaseb-backup-v1', 'fixtures': [], 'synthetic': True},
            ),
            patch.object(
                scheduler,
                'settings',
                SimpleNamespace(DATABASES={'default': {'NAME': str(root / 'synthetic.sqlite3')}}),
            ),
        ]
        for item in patches:
            item.start()
            self.addCleanup(item.stop)
        now = datetime.fromisoformat('2026-10-19T09:30:00+00:00')  # 13:00 Tehran
        with patch('api.scheduler.timezone.now', return_value=now):
            result = scheduler.run_due_backup()
        self.assertTrue(result['ran'], result)
        return Path(result['path'])

    def test_scheduled_backup_encrypted_with_stored_passphrase(self):
        path = self._run(encrypt_secret(STORED))
        payload = json.loads(path.read_text(encoding='utf-8'))
        self.assertTrue(is_encrypted_backup(payload))
        opened = decrypt_backup(payload, STORED)
        self.assertTrue(opened['synthetic'])

    def test_scheduled_backup_plain_without_stored_passphrase(self):
        path = self._run('')
        payload = json.loads(path.read_text(encoding='utf-8'))
        self.assertFalse(is_encrypted_backup(payload))
        self.assertEqual(payload['format'], 'mohaseb-backup-v1')


class RestorePassphraseRecoveryTests(APITestCase):
    def setUp(self):
        # force_authenticate: the token endpoint throttles repeated
        # logins, which made per-test token fetches flaky under load.
        self.admin = User.objects.create_superuser(username='pass-admin', password='manual' + '-pass-11')
        self.client.force_authenticate(self.admin)
        config = BackupConfig.load()
        config.cloud_passphrase = STORED
        config.save()

    def _envelope_text(self, passphrase):
        response = self.client.post('/api/backup/download/', {'passphrase': passphrase}, format='json')
        self.assertEqual(response.status_code, 200)
        return response.content.decode('utf-8')

    def _restore(self, raw, **extra):
        return self.client.post(
            '/api/backup/restore/',
            {'backup_json': raw, 'confirm_replace': False, **extra},
            format='json',
        )

    def test_restore_with_typed_passphrase_reports_typed(self):
        checked = self._restore(self._envelope_text(STORED), passphrase=STORED)
        self.assertEqual(checked.status_code, 200, checked.content)
        self.assertEqual(checked.data['passphrase_source'], 'typed')

    def test_restore_falls_back_to_stored_passphrase(self):
        checked = self._restore(self._envelope_text(STORED), passphrase=TYPED)
        self.assertEqual(checked.status_code, 200, checked.content)
        self.assertTrue(checked.data['valid'])
        self.assertEqual(checked.data['passphrase_source'], 'stored')

    def test_restore_without_passphrase_uses_stored(self):
        checked = self._restore(self._envelope_text(STORED))
        self.assertEqual(checked.status_code, 200, checked.content)
        self.assertEqual(checked.data['passphrase_source'], 'stored')

    def test_restore_still_fails_when_neither_matches(self):
        checked = self._restore(self._envelope_text('other-pass-33'), passphrase=TYPED)
        self.assertEqual(checked.status_code, 400)

    def test_cloud_restore_defaults_to_stored_passphrase(self):
        config = BackupConfig.load()
        config.cloud_enabled = True
        config.cloud_endpoint = 'https://s3.ir-thr-at1.arvanstorage.ir'
        config.cloud_bucket = 'bucket-x'
        config.cloud_access_key = 'access-x'
        config.cloud_secret_key = 'secret-x'
        config.save()
        from ..backup_utils import build_backup

        plain = json.dumps(build_backup(), ensure_ascii=False, indent=2, default=str)
        raw = json.dumps(encrypt_backup(plain, STORED), ensure_ascii=False).encode('utf-8')
        with patch('api.cloud_backup.get_s3_client', return_value=object()), patch(
            'api.cloud_backup.download_object', return_value=raw
        ):
            response = self.client.post(
                '/api/backup-config/restore_cloud/',
                {'key': 'mohaseb_backup_20260101_000000.json'},
                format='json',
            )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.data['valid'])
        self.assertEqual(response.data['passphrase_source'], 'stored')
