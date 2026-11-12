"""DATABASE_URL / REDIS_URL opt-ins must not disturb the defaults.

The default single-machine setup stays a local SQLite file plus the
in-memory channel layer; only when the environment asks for it do we
switch to PostgreSQL / Redis (see core/db_config.py).
"""
from pathlib import Path

from django.test import SimpleTestCase

from core.db_config import channel_layers_from_env, databases_from_env


class DatabasesFromEnvTests(SimpleTestCase):
    def test_default_is_sqlite_file_with_timeout(self):
        cfg = databases_from_env({}, base_dir=Path('/srv/mohaseb'))['default']
        self.assertEqual(cfg['ENGINE'], 'django.db.backends.sqlite3')
        self.assertEqual(cfg['NAME'], Path('/srv/mohaseb') / 'db.sqlite3')
        self.assertEqual(cfg['OPTIONS'], {'timeout': 30, 'transaction_mode': 'IMMEDIATE'})

    def test_default_honours_django_db_path(self):
        env = {'DJANGO_DB_PATH': '/data/custom.sqlite3'}
        cfg = databases_from_env(env, base_dir=Path('/srv/mohaseb'))['default']
        self.assertEqual(cfg['NAME'], '/data/custom.sqlite3')

    def test_postgres_url_is_parsed(self):
        env = {'DATABASE_URL': 'postgres://user:secret@db.internal:5433/shop'}
        cfg = databases_from_env(env)['default']
        self.assertEqual(cfg['ENGINE'], 'django.db.backends.postgresql')
        self.assertEqual(cfg['NAME'], 'shop')
        self.assertEqual(cfg['USER'], 'user')
        self.assertEqual(cfg['HOST'], 'db.internal')
        self.assertEqual(cfg['PORT'], 5433)
        self.assertEqual(cfg['CONN_MAX_AGE'], 60)

    def test_blank_database_url_falls_back_to_sqlite(self):
        cfg = databases_from_env({'DATABASE_URL': '  '})['default']
        self.assertEqual(cfg['ENGINE'], 'django.db.backends.sqlite3')


class ChannelLayersFromEnvTests(SimpleTestCase):
    def test_default_is_in_memory(self):
        layer = channel_layers_from_env({})['default']
        self.assertEqual(layer['BACKEND'], 'channels.layers.InMemoryChannelLayer')

    def test_redis_url_switches_backend(self):
        env = {'REDIS_URL': 'redis://127.0.0.1:6379/3'}
        layer = channel_layers_from_env(env)['default']
        self.assertEqual(layer['BACKEND'], 'channels_redis.core.RedisChannelLayer')
        self.assertEqual(layer['CONFIG']['hosts'], ['redis://127.0.0.1:6379/3'])
