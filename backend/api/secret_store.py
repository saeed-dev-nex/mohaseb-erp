"""Encryption at rest for secrets stored in the database.

Used for the cloud-backup credentials on ``BackupConfig``: the S3 secret
key and the cloud passphrase must not sit in ``db.sqlite3`` (or in backup
files, which include the config row) as plaintext.

Values are encrypted with Fernet (AES-128-CBC + HMAC-SHA256) under a key
derived from Django's ``SECRET_KEY`` — the server already keeps that key
persistent (``backend/.secret_key``), so no new key material is introduced.

Stored values carry an ``enc:v1:`` prefix. Anything without the prefix is
legacy plaintext and is returned unchanged, so existing installs keep
working and are upgraded transparently the next time the row is saved
(or by migration 0028, which encrypts existing rows in place).
"""

import base64
import hashlib

from django.conf import settings

_PREFIX = 'enc:v1:'


def _fernet():
    from cryptography.fernet import Fernet

    digest = hashlib.sha256(settings.SECRET_KEY.encode('utf-8')).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def is_encrypted(value):
    return bool(value) and str(value).startswith(_PREFIX)


def encrypt_secret(value):
    """Encrypt a plaintext secret for storage; idempotent, keeps '' as ''."""
    if not value:
        return ''
    if is_encrypted(value):
        return value
    token = _fernet().encrypt(str(value).encode('utf-8')).decode('ascii')
    return _PREFIX + token


def decrypt_secret(value):
    """Return the plaintext for a stored value.

    Legacy plaintext (no prefix) is returned as-is. A value that carries
    the prefix but cannot be decrypted (e.g. SECRET_KEY was rotated)
    yields '' so callers treat the credential as missing instead of
    sending ciphertext to the remote service.
    """
    if not value:
        return ''
    if not is_encrypted(value):
        return value
    from cryptography.fernet import InvalidToken

    try:
        token = str(value)[len(_PREFIX):].encode('ascii')
        return _fernet().decrypt(token).decode('utf-8')
    except (InvalidToken, ValueError, UnicodeDecodeError):
        return ''
