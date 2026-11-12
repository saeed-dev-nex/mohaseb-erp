"""Production must refuse to start without a stable secret key.

A random per-process key would invalidate every JWT/session on restart,
so settings.py raises ImproperlyConfigured when DEBUG is off and
DJANGO_SECRET_KEY is missing. This runs a real subprocess to prove it.
"""

import os
import subprocess
import sys
from pathlib import Path

from django.test import SimpleTestCase

BACKEND_DIR = Path(__file__).resolve().parents[2]


class ProductionSecretKeyTests(SimpleTestCase):
    def run_check(self, **env_overrides):
        env = dict(os.environ)
        env.pop('DJANGO_SECRET_KEY', None)
        env.update(env_overrides)
        return subprocess.run(
            [sys.executable, 'manage.py', 'check'],
            cwd=BACKEND_DIR, env=env, capture_output=True, text=True, timeout=120,
        )

    def test_production_without_secret_key_fails_fast(self):
        result = self.run_check(DJANGO_DEBUG='false')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('DJANGO_SECRET_KEY', result.stderr + result.stdout)

    def test_production_with_secret_key_starts(self):
        result = self.run_check(DJANGO_DEBUG='false', DJANGO_SECRET_KEY='test-secret-for-ci')
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_database_and_media_paths_come_from_environment(self):
        env = dict(os.environ)
        env.update({
            'DJANGO_SECRET_KEY': 'test-secret-for-ci',
            'DJANGO_DB_PATH': '/data/db.sqlite3',
            'DJANGO_MEDIA_ROOT': '/data/media',
            # This test verifies the SQLite path variables; a DATABASE_URL
            # inherited from the developer's shell would take precedence
            # over DJANGO_DB_PATH and is not what is being asserted here.
            'DATABASE_URL': '',
            'REDIS_URL': '',
        })
        code = (
            'import django; from django.conf import settings; django.setup();'
            'print(settings.DATABASES["default"]["NAME"]); print(settings.MEDIA_ROOT)'
        )
        result = subprocess.run(
            [sys.executable, '-c', code], cwd=BACKEND_DIR, env=env,
            capture_output=True, text=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('/data/db.sqlite3', result.stdout)
        self.assertIn('/data/media', result.stdout)
