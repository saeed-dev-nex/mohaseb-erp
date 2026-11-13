"""SECRET_KEY resolution regression tests (run in a subprocess).

An install that has a persisted backend/.secret_key must boot with
DJANGO_DEBUG off and no DJANGO_SECRET_KEY in the environment — the
network launcher turns DEBUG off, and previously the persisted-key
fallback only applied in DEBUG mode, so such installs died at
migrate time with ImproperlyConfigured. A fresh install with no key
anywhere must still fail fast in production mode.
"""

import os
import subprocess
import sys
from pathlib import Path

from django.test import SimpleTestCase

BACKEND_DIR = Path(__file__).resolve().parents[2]
KEY_FILE = BACKEND_DIR / '.secret_key'


def _run_check():
    env = {
        key: value
        for key, value in os.environ.items()
        if key not in ('DJANGO_SECRET_KEY', 'DATABASE_URL')
    }
    env['DJANGO_DEBUG'] = 'false'
    return subprocess.run(
        [sys.executable, 'manage.py', 'check'],
        cwd=BACKEND_DIR, env=env, capture_output=True, text=True,
        timeout=120,
    )


class SecretKeyResolutionTests(SimpleTestCase):
    def setUp(self):
        self._backup = KEY_FILE.read_bytes() if KEY_FILE.exists() else None
        self.addCleanup(self._restore)

    def _restore(self):
        if self._backup is None:
            KEY_FILE.unlink(missing_ok=True)
        else:
            KEY_FILE.write_bytes(self._backup)

    def test_persisted_key_boots_with_debug_off(self):
        KEY_FILE.write_text('persisted-test-key', encoding='utf-8')
        result = _run_check()
        self.assertEqual(result.returncode, 0, result.stderr[-2000:])

    def test_no_key_anywhere_fails_fast_with_debug_off(self):
        KEY_FILE.unlink(missing_ok=True)
        result = _run_check()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('DJANGO_SECRET_KEY must be set', result.stderr)
