"""Reject malicious encrypted metadata before expensive cryptography runs."""

import base64
from unittest.mock import patch

from django.test import SimpleTestCase

from api.backup_utils import ENCRYPTED_BACKUP_FORMAT, decrypt_backup


class BackupEnvelopeLimitTests(SimpleTestCase):
    def envelope(self):
        return {
            'format': ENCRYPTED_BACKUP_FORMAT,
            'iterations': 600_000,
            'salt': base64.b64encode(b's' * 16).decode(),
            'nonce': base64.b64encode(b'n' * 12).decode(),
            'ciphertext': base64.b64encode(b'x' * 16).decode(),
        }

    def test_untrusted_work_factor_is_bounded_before_derivation(self):
        for iterations in [0, -1, 99_999, 2_000_001, 10**18, True, '600000']:
            with self.subTest(iterations=iterations):
                envelope = {**self.envelope(), 'iterations': iterations}
                with patch('api.backup_utils._derive_backup_key') as derive:
                    with self.assertRaises(ValueError):
                        decrypt_backup(envelope, 'synthetic-passphrase')
                derive.assert_not_called()

    def test_invalid_salt_nonce_and_ciphertext_are_rejected_early(self):
        for field in ['salt', 'nonce', 'ciphertext']:
            with self.subTest(field=field):
                envelope = {**self.envelope(), field: base64.b64encode(b'x').decode()}
                with patch('api.backup_utils._derive_backup_key') as derive:
                    with self.assertRaises(ValueError):
                        decrypt_backup(envelope, 'synthetic-passphrase')
                derive.assert_not_called()
