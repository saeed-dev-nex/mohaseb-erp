"""Security hardening tests (audit follow-up, 2026-10-29).

- Cloud credentials are encrypted at rest (api/secret_store.py), with
  legacy plaintext rows still readable and upgraded by migration 0028.
- customer_documents_path validation refuses relative paths, filesystem
  roots, and operating-system directories.
"""

from django.apps import apps as global_apps
from django.test import TestCase
from rest_framework import serializers as drf_serializers

from api.cloud_backup import is_configured
from api.models import BackupConfig
from api.secret_store import decrypt_secret, encrypt_secret, is_encrypted
from api.validators import validate_customer_documents_path


class SecretStoreTests(TestCase):
    def test_round_trip(self):
        token = encrypt_secret('my-s3-secret')
        self.assertTrue(is_encrypted(token))
        self.assertNotIn('my-s3-secret', token)
        self.assertEqual(decrypt_secret(token), 'my-s3-secret')

    def test_empty_stays_empty(self):
        self.assertEqual(encrypt_secret(''), '')
        self.assertEqual(decrypt_secret(''), '')
        self.assertEqual(decrypt_secret(None), '')

    def test_encrypt_is_idempotent(self):
        token = encrypt_secret('abc12345')
        self.assertEqual(encrypt_secret(token), token)

    def test_legacy_plaintext_passes_through(self):
        self.assertEqual(decrypt_secret('legacy-plain'), 'legacy-plain')

    def test_undecryptable_value_yields_empty(self):
        self.assertEqual(decrypt_secret('enc:v1:not-a-real-token'), '')


class CloudSecretAtRestTests(TestCase):
    def test_save_encrypts_and_accessors_decrypt(self):
        config = BackupConfig.load()
        config.cloud_secret_key = 'AKIA-SECRET-VALUE'
        config.cloud_passphrase = 'cloud-pass-123'
        config.save()
        raw = BackupConfig.objects.values(
            'cloud_secret_key', 'cloud_passphrase'
        ).get(pk=1)
        self.assertTrue(is_encrypted(raw['cloud_secret_key']))
        self.assertTrue(is_encrypted(raw['cloud_passphrase']))
        self.assertNotIn('AKIA-SECRET-VALUE', raw['cloud_secret_key'])
        fresh = BackupConfig.load()
        self.assertEqual(fresh.decrypted_cloud_secret_key(), 'AKIA-SECRET-VALUE')
        self.assertEqual(fresh.decrypted_cloud_passphrase(), 'cloud-pass-123')

    def test_is_configured_with_encrypted_secret(self):
        config = BackupConfig.load()
        config.cloud_bucket = 'backups'
        config.cloud_access_key = 'access'
        config.cloud_secret_key = 'secret'
        config.save()
        self.assertTrue(is_configured(BackupConfig.load()))

    def test_migration_0028_encrypts_legacy_rows(self):
        import importlib

        migration = importlib.import_module(
            'api.migrations.0028_encrypt_cloud_secrets'
        )
        # Simulate a pre-migration row: write plaintext bypassing save().
        BackupConfig.objects.get_or_create(pk=1)
        BackupConfig.objects.filter(pk=1).update(
            cloud_secret_key='legacy-secret', cloud_passphrase='legacy-pass'
        )
        migration.encrypt_existing_secrets(global_apps, None)
        raw = BackupConfig.objects.values(
            'cloud_secret_key', 'cloud_passphrase'
        ).get(pk=1)
        self.assertTrue(is_encrypted(raw['cloud_secret_key']))
        self.assertTrue(is_encrypted(raw['cloud_passphrase']))
        fresh = BackupConfig.load()
        self.assertEqual(fresh.decrypted_cloud_secret_key(), 'legacy-secret')
        self.assertEqual(fresh.decrypted_cloud_passphrase(), 'legacy-pass')
        # Idempotent: running it again changes nothing.
        migration.encrypt_existing_secrets(global_apps, None)
        self.assertEqual(
            BackupConfig.load().decrypted_cloud_secret_key(), 'legacy-secret'
        )


class CustomerDocumentsPathValidationTests(TestCase):
    def assertRejected(self, value):
        with self.assertRaises(drf_serializers.ValidationError):
            validate_customer_documents_path(value)

    def test_empty_is_allowed(self):
        self.assertEqual(validate_customer_documents_path(''), '')

    def test_data_paths_are_allowed(self):
        for value in (
            'E:\\MohasebDocuments',
            'D:\\Data\\Customer Docs',
            '\\\\server\\share\\docs',
            '/srv/mohaseb/docs',
            '/home/office/documents',
        ):
            self.assertEqual(validate_customer_documents_path(value), value)

    def test_relative_paths_are_rejected(self):
        self.assertRejected('docs')
        self.assertRejected('..\\docs')
        self.assertRejected('./documents')

    def test_roots_are_rejected(self):
        self.assertRejected('C:\\')
        self.assertRejected('D:')
        self.assertRejected('/')

    def test_system_directories_are_rejected(self):
        self.assertRejected('C:\\Windows')
        self.assertRejected('C:\\Windows\\System32')
        self.assertRejected('c:\\program files\\app')
        self.assertRejected('C:\\ProgramData')
        self.assertRejected('/etc')
        self.assertRejected('/usr/share/docs')
