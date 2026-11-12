"""Off-site (S3-compatible) copies of local backups.

Local backups stay exactly as before. After a backup file is written to the
server path, the same file is also uploaded to the configured S3 bucket --
but never in plaintext: an already-encrypted envelope is uploaded as-is,
and a plain backup is encrypted first with the configured cloud passphrase.
A plain backup with no cloud passphrase configured is skipped (never
uploaded unencrypted) and the skip is recorded on the config.

Upload failures never break the local backup: they are recorded on the
config and returned to the caller, never raised.
"""

import json
import logging
import re

from django.utils import timezone

from .secret_store import decrypt_secret

logger = logging.getLogger(__name__)

DEFAULT_ENDPOINT = 'https://s3.ir-thr-at1.arvanstorage.ir'
BACKUP_KEY_PREFIX = 'mohaseb_backup_'


class CloudBackupError(Exception):
    """User-facing cloud backup failure (message is safe to display)."""


def region_from_endpoint(endpoint):
    """Derive the signing region from an S3 endpoint host.

    ArvanCloud endpoints look like ``s3.<region>.arvanstorage.ir``; generic
    endpoints fall back to ``us-east-1`` (the region is only used for SigV4
    signing and is ignored by most S3-compatible stores).
    """
    match = re.search(r's3\.([a-z0-9-]+)\.[a-z0-9-]+\.[a-z]+', endpoint or '')
    return match.group(1) if match else 'us-east-1'


def get_s3_client(config):
    """Build a boto3 S3 client from a BackupConfig-like object."""
    try:
        import boto3
        from botocore.config import Config
    except ImportError as error:
        raise CloudBackupError('کتابخانهٔ boto3 روی سرور نصب نشده است.') from error
    endpoint = (config.cloud_endpoint or DEFAULT_ENDPOINT).strip()
    return boto3.client(
        's3',
        endpoint_url=endpoint,
        aws_access_key_id=config.cloud_access_key,
        # Stored values are encrypted at rest (plaintext test-before-save
        # overrides pass through decrypt_secret unchanged).
        aws_secret_access_key=decrypt_secret(config.cloud_secret_key),
        region_name=region_from_endpoint(endpoint),
        config=Config(signature_version='s3v4'),
    )


def is_configured(config):
    """True when every credential the S3 client needs is present."""
    return bool(
        (config.cloud_endpoint or '').strip()
        and (config.cloud_bucket or '').strip()
        and (config.cloud_access_key or '').strip()
        and decrypt_secret(config.cloud_secret_key).strip()
    )


def prepare_cloud_payload(local_path, config):
    """Read a local backup file and return the bytes to upload.

    Encrypted envelopes go up unchanged. Plain backups are encrypted with
    the configured cloud passphrase; without one, the upload is refused
    rather than sending customer data in plaintext.
    """
    from .backup_utils import encrypt_backup, is_encrypted_backup

    try:
        with open(local_path, 'r', encoding='utf-8') as backup_file:
            text = backup_file.read()
        payload = json.loads(text)
    except (OSError, ValueError) as error:
        raise CloudBackupError('فایل بکاپ محلی خوانا نیست.') from error
    if is_encrypted_backup(payload):
        return text.encode('utf-8')
    passphrase = decrypt_secret(config.cloud_passphrase).strip()
    if not passphrase:
        raise CloudBackupError(
            'برای آپلود ابری بکاپ بدون رمز، گذرواژهٔ بکاپ ابری تنظیم نشده است.'
        )
    try:
        envelope = encrypt_backup(text, passphrase)
    except ValueError as error:
        raise CloudBackupError(str(error) or 'گذرواژهٔ بکاپ ابری معتبر نیست.') from error
    return json.dumps(envelope, ensure_ascii=False, indent=2).encode('utf-8')


def upload_object(client, bucket, key, data):
    client.put_object(Bucket=bucket, Key=key, Body=data)


def list_backups(client, bucket):
    """Newest-first list of backup objects in the bucket."""
    paginator = client.get_paginator('list_objects_v2')
    items = []
    for page in paginator.paginate(Bucket=bucket, Prefix=BACKUP_KEY_PREFIX):
        for entry in page.get('Contents', []):
            items.append({
                'key': entry['Key'],
                'size': entry['Size'],
                'last_modified': entry['LastModified'].isoformat(),
            })
    items.sort(key=lambda item: item['last_modified'], reverse=True)
    return items


def download_object(client, bucket, key):
    return client.get_object(Bucket=bucket, Key=key)['Body'].read()


def delete_object(client, bucket, key):
    client.delete_object(Bucket=bucket, Key=key)


def prune(client, bucket, retention):
    """Delete all but the newest ``retention`` backups; return deleted count."""
    keep = max(1, int(retention or 30))
    items = list_backups(client, bucket)
    deleted = 0
    for item in items[keep:]:
        delete_object(client, bucket, item['key'])
        deleted += 1
    return deleted


def test_connection(config, client=None):
    """Verify endpoint, bucket and credentials; raise CloudBackupError."""
    from botocore.exceptions import ClientError, EndpointConnectionError

    client = client or get_s3_client(config)
    try:
        client.head_bucket(Bucket=config.cloud_bucket)
    except ClientError as error:
        code = error.response.get('Error', {}).get('Code', '')
        if code in {'404', 'NoSuchBucket'}:
            raise CloudBackupError('باکت ابری پیدا نشد؛ نام باکت را بررسی کنید.') from error
        if code in {'403', 'AccessDenied', 'InvalidAccessKeyId', 'SignatureDoesNotMatch'}:
            raise CloudBackupError('دسترسی به باکت رد شد؛ کلیدها را بررسی کنید.') from error
        raise CloudBackupError(f'خطای سرویس ابری: {code or error}') from error
    except EndpointConnectionError as error:
        raise CloudBackupError('اتصال به نقطهٔ پایانی ابری برقرار نشد.') from error
    except Exception as error:
        raise CloudBackupError(f'بررسی اتصال ابری ناموفق بود: {error}') from error
    return True


def upload_local_backup(config, local_path, filename, client=None):
    """Best-effort cloud copy of one local backup file.

    Never raises: the result dict always describes what happened, and the
    config records the last cloud success or error for the settings UI.
    """
    if not config.cloud_enabled:
        return {'uploaded': False, 'reason': 'بکاپ ابری فعال نیست.'}
    if not is_configured(config):
        return {'uploaded': False, 'reason': 'پیکربندی ابری کامل نیست.'}
    try:
        data = prepare_cloud_payload(local_path, config)
        client = client or get_s3_client(config)
        upload_object(client, config.cloud_bucket, filename, data)
        pruned = prune(client, config.cloud_bucket, config.cloud_retention)
        config.last_cloud_backup_at = timezone.now()
        config.last_cloud_backup_key = filename
        config.last_cloud_error = ''
        config.save(update_fields=[
            'last_cloud_backup_at', 'last_cloud_backup_key', 'last_cloud_error',
        ])
        logger.info('Cloud backup uploaded: %s', filename)
        return {'uploaded': True, 'key': filename, 'pruned': pruned}
    except Exception as error:
        message = (str(error) or 'خطای نامشخص')[:300]
        logger.exception('Cloud backup upload failed for %s', filename)
        try:
            config.last_cloud_error = message
            config.save(update_fields=['last_cloud_error'])
        except Exception:
            logger.exception('Could not record cloud backup error')
        return {'uploaded': False, 'reason': message}
