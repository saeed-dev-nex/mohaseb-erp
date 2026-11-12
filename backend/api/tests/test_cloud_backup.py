"""Cloud backup tests: encryption-before-upload, retention, never-fail-local."""

import json
import os
import tempfile
from datetime import datetime, timedelta, timezone as dt_timezone

from django.test import TestCase

from api.backup_utils import (
    build_backup, decrypt_backup, encrypt_backup, is_encrypted_backup, validate_backup,
)
from api.cloud_backup import (
    CloudBackupError, prepare_cloud_payload, region_from_endpoint, upload_local_backup,
)
from api.models import BackupConfig
from api.serializers import BackupConfigSerializer


class FakeBody:
    def __init__(self, data):
        self._data = data

    def read(self):
        return self._data


class FakePaginator:
    def __init__(self, client):
        self.client = client

    def paginate(self, Bucket, Prefix=''):
        contents = [
            {'Key': key, 'Size': len(data), 'LastModified': stamp}
            for key, (data, stamp) in sorted(self.client.objects.items())
            if key.startswith(Prefix)
        ]
        yield {'Contents': contents}


class FakeS3:
    """Minimal in-memory S3 stand-in (put/get/delete/list/head)."""

    def __init__(self):
        self.objects = {}
        self._seq = 0

    def _stamp(self):
        self._seq += 1
        return datetime.now(dt_timezone.utc) + timedelta(seconds=self._seq)

    def put_object(self, Bucket, Key, Body):
        self.objects[Key] = (bytes(Body), self._stamp())

    def get_object(self, Bucket, Key):
        return {'Body': FakeBody(self.objects[Key][0])}

    def delete_object(self, Bucket, Key):
        self.objects.pop(Key, None)

    def head_bucket(self, Bucket):
        return {}

    def get_paginator(self, name):
        assert name == 'list_objects_v2'
        return FakePaginator(self)


class FailingS3(FakeS3):
    def put_object(self, Bucket, Key, Body):
        raise RuntimeError('network down')


def write_temp(content):
    handle, path = tempfile.mkstemp(suffix='.json')
    with os.fdopen(handle, 'w', encoding='utf-8') as backup_file:
        backup_file.write(content)
    return path


class CloudBackupTests(TestCase):
    def setUp(self):
        self.cfg = BackupConfig.load()
        self.cfg.cloud_enabled = True
        self.cfg.cloud_endpoint = 'https://s3.ir-thr-at1.arvanstorage.ir'
        self.cfg.cloud_bucket = 'test-bucket'
        self.cfg.cloud_access_key = 'test-access'
        self.cfg.cloud_secret_key = 'test-secret'
        self.cfg.cloud_passphrase = 'strong-passphrase-1'
        self.cfg.cloud_retention = 30
        self.cfg.save()

    def tearDown(self):
        for path in getattr(self, '_temps', []):
            try:
                os.unlink(path)
            except OSError:
                pass

    def _temp(self, content):
        path = write_temp(content)
        self._temps = getattr(self, '_temps', []) + [path]
        return path

    def test_region_from_endpoint(self):
        self.assertEqual(
            region_from_endpoint('https://s3.ir-thr-at1.arvanstorage.ir'), 'ir-thr-at1')
        self.assertEqual(region_from_endpoint('https://s3.example.com'), 'us-east-1')

    def test_encrypted_envelope_uploads_unchanged(self):
        plain = json.dumps(build_backup(), ensure_ascii=False)
        envelope = json.dumps(encrypt_backup(plain, 'strong-passphrase-1'), ensure_ascii=False)
        path = self._temp(envelope)
        self.assertEqual(prepare_cloud_payload(path, self.cfg), envelope.encode('utf-8'))

    def test_plain_backup_encrypted_with_cloud_passphrase(self):
        plain = json.dumps(build_backup(), ensure_ascii=False)
        path = self._temp(plain)
        payload = prepare_cloud_payload(path, self.cfg)
        self.assertTrue(is_encrypted_backup(json.loads(payload.decode('utf-8'))))
        restored = decrypt_backup(json.loads(payload.decode('utf-8')), 'strong-passphrase-1')
        validate_backup(restored)

    def test_plain_backup_without_passphrase_is_refused(self):
        self.cfg.cloud_passphrase = ''
        self.cfg.save()
        path = self._temp(json.dumps(build_backup(), ensure_ascii=False))
        with self.assertRaises(CloudBackupError):
            prepare_cloud_payload(path, self.cfg)

    def test_upload_skipped_when_disabled(self):
        self.cfg.cloud_enabled = False
        self.cfg.save()
        path = self._temp(json.dumps(build_backup(), ensure_ascii=False))
        fake = FakeS3()
        result = upload_local_backup(self.cfg, path, 'mohaseb_backup_a.json', client=fake)
        self.assertFalse(result['uploaded'])
        self.assertEqual(fake.objects, {})

    def test_upload_and_prune_keeps_newest(self):
        self.cfg.cloud_retention = 2
        self.cfg.save()
        fake = FakeS3()
        for name in ['mohaseb_backup_1.json', 'mohaseb_backup_2.json', 'mohaseb_backup_3.json']:
            path = self._temp(json.dumps(build_backup(), ensure_ascii=False))
            result = upload_local_backup(self.cfg, path, name, client=fake)
            self.assertTrue(result['uploaded'])
        self.assertEqual(
            sorted(fake.objects), ['mohaseb_backup_2.json', 'mohaseb_backup_3.json'])
        self.cfg.refresh_from_db()
        self.assertEqual(self.cfg.last_cloud_backup_key, 'mohaseb_backup_3.json')
        self.assertEqual(self.cfg.last_cloud_error, '')

    def test_upload_failure_never_raises_and_is_recorded(self):
        path = self._temp(json.dumps(build_backup(), ensure_ascii=False))
        result = upload_local_backup(
            self.cfg, path, 'mohaseb_backup_x.json', client=FailingS3())
        self.assertFalse(result['uploaded'])
        self.cfg.refresh_from_db()
        self.assertIn('network down', self.cfg.last_cloud_error)

    def test_serializer_hides_secrets(self):
        data = BackupConfigSerializer(self.cfg).data
        self.assertNotIn('cloud_secret_key', data)
        self.assertNotIn('cloud_passphrase', data)
        self.assertIn('cloud_bucket', data)
