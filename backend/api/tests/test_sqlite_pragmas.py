"""SQLite connections must be tuned for multi-operator LAN use.

The pragmas are applied by ``api.apps._set_sqlite_pragmas`` on every new
connection: WAL journal mode, synchronous=NORMAL and a 30s busy timeout so
concurrent operators wait for locks instead of hitting "database is locked".
"""
from django.db import connection
from django.test import TestCase


class SqlitePragmaTests(TestCase):
    def _pragma(self, name):
        with connection.cursor() as cursor:
            cursor.execute(f'PRAGMA {name};')
            row = cursor.fetchone()
        return row[0] if row else None

    def test_sqlite_only(self):
        if connection.vendor != 'sqlite':
            self.skipTest('SQLite-only tuning')

    def test_busy_timeout_is_30s(self):
        self.test_sqlite_only()
        self.assertEqual(self._pragma('busy_timeout'), 30000)

    def test_synchronous_is_normal(self):
        self.test_sqlite_only()
        # PRAGMA synchronous: 0=OFF, 1=NORMAL, 2=FULL
        self.assertEqual(self._pragma('synchronous'), 1)

    def test_journal_mode_is_wal_for_file_databases(self):
        self.test_sqlite_only()
        # In-memory test databases report "memory"; file databases must
        # have been switched to WAL by the connection handler.
        self.assertIn(str(self._pragma('journal_mode')).lower(), {'wal', 'memory'})
