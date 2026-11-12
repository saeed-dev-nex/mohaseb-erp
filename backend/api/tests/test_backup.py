"""Backup integrity tests: checksum validation must catch tampered files."""

import copy
import json

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APITestCase

from api.backup_utils import (
    build_backup, decrypt_backup, encrypt_backup, is_encrypted_backup, restore_backup,
    validate_backup,
)
from api.models import Customer, Document, Invoice, InvoiceNumberCounter


class BackupTests(TestCase):
    def setUp(self):
        User.objects.create_user(username='backup-user', password='test-pass-123')
        Customer.objects.create(name='مشتری بکاپ', phone='09120000000')

    def test_built_backup_passes_validation(self):
        payload = build_backup()
        self.assertEqual(payload['format'], 'mohaseb-backup-v1')
        counts = validate_backup(payload)
        self.assertGreaterEqual(counts['api.customer'], 1)

    def test_tampered_backup_fails_checksum(self):
        payload = build_backup()
        tampered = copy.deepcopy(payload)
        tampered['fixtures'] = tampered['fixtures'] + tampered['fixtures'][:1]
        with self.assertRaises(ValueError):
            validate_backup(tampered)

    def test_backup_with_wrong_format_is_rejected(self):
        with self.assertRaises(ValueError):
            validate_backup({'format': 'something-else', 'fixtures': []})


class BackupEncryptionTests(TestCase):
    def test_encrypt_decrypt_roundtrip_preserves_valid_backup(self):
        plain = json.dumps(build_backup(), ensure_ascii=False)
        envelope = encrypt_backup(plain, 'strong-passphrase-1')
        self.assertTrue(is_encrypted_backup(envelope))
        self.assertNotIn('fixtures', envelope)
        restored = decrypt_backup(envelope, 'strong-passphrase-1')
        validate_backup(restored)

    def test_wrong_passphrase_is_rejected(self):
        envelope = encrypt_backup('{"format": "mohaseb-backup-v1"}', 'correct-passphrase')
        with self.assertRaises(ValueError):
            decrypt_backup(envelope, 'wrong-passphrase')

    def test_short_passphrase_is_rejected(self):
        with self.assertRaises(ValueError):
            encrypt_backup('{}', 'short')

    def test_encrypted_payload_does_not_leak_plaintext(self):
        envelope = encrypt_backup('{"secret_customer": "mohaseb"}', 'strong-passphrase-1')
        self.assertNotIn('secret_customer', json.dumps(envelope))


class EncryptedBackupApiTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(username='backup-admin', password='test-pass-123')
        Customer.objects.create(name='مشتری رمزنگاری')
        token = self.client.post('/api/token/', {'username': 'backup-admin', 'password': 'test-pass-123'}, format='json')
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.data['access']}")

    def test_download_with_passphrase_returns_encrypted_envelope(self):
        response = self.client.post('/api/backup/download/', {'passphrase': 'strong-passphrase-1'}, format='json')
        self.assertEqual(response.status_code, 200)
        envelope = json.loads(response.content)
        self.assertTrue(is_encrypted_backup(envelope))

    def test_restore_encrypted_backup_needs_and_accepts_passphrase(self):
        download = self.client.post('/api/backup/download/', {'passphrase': 'strong-passphrase-1'}, format='json')
        raw = download.content.decode('utf-8')
        without = self.client.post('/api/backup/restore/', {'backup_json': raw, 'confirm_replace': False}, format='json')
        self.assertEqual(without.status_code, 400)
        checked = self.client.post(
            '/api/backup/restore/',
            {'backup_json': raw, 'confirm_replace': False, 'passphrase': 'strong-passphrase-1'},
            format='json',
        )
        self.assertEqual(checked.status_code, 200, checked.content)
        self.assertTrue(checked.data['valid'])
        self.assertGreaterEqual(checked.data['counts']['api.customer'], 1)


class BackupRestoreCounterTests(TestCase):
    """Regression: restoring a backup must re-sync the invoice-number
    counter. If invoices were created locally before the restore, the
    counter lags behind the restored INV numbers and every new invoice
    used to fail with a duplicate-number integrity error."""

    def test_restore_resyncs_invoice_number_counter(self):
        user = User.objects.create_user(username='counter-user', password='x')
        customer = Customer.objects.create(name='مشتری شمارنده', phone='09120000000')
        # Backup source state: two invoices, INV-00001 and INV-00002.
        Invoice.objects.create(customer=customer, total_amount=1000, status='pending')
        Invoice.objects.create(customer=customer, total_amount=2000, status='pending')
        payload = build_backup()
        # Pre-restore local state: only one local invoice was ever created,
        # so the counter sits at 1 while the backup already uses INV-00002.
        Invoice.objects.all().delete()
        Invoice.objects.create(customer=customer, total_amount=500, status='pending')
        InvoiceNumberCounter.objects.update_or_create(pk=1, defaults={'last_number': 1})

        restore_backup(payload, fallback_user_id=user.id)

        counter = InvoiceNumberCounter.objects.get(pk=1)
        self.assertGreaterEqual(counter.last_number, 2)
        new_invoice = Invoice.objects.create(
            customer=customer, total_amount=3000, status='pending'
        )
        self.assertEqual(new_invoice.invoice_number, 'INV-00003')


class BackupMissingMediaTests(TestCase):
    """Regression: one missing document file must not fail the backup.

    build_backup used to raise ValueError on the first OSError while
    reading a document file, so a single missing attachment blocked every
    manual and scheduled backup. Missing files are now recorded in the
    payload (recovered from the customer-folder copy when available)
    instead."""

    def test_missing_document_file_is_recorded_not_fatal(self):
        customer = Customer.objects.create(name='مشتری سند', phone='09120000000')
        Document.objects.create(customer=customer, title='سند گمشده', file='customer_docs/missing.png')
        payload = build_backup()
        self.assertNotIn('customer_docs/missing.png', payload['media_files'])
        self.assertIn('customer_docs/missing.png', payload['missing_media_files'])
        validate_backup(payload)
