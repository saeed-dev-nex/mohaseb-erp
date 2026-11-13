"""First-run setup wizard: open only while no superuser exists."""

from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from api import db_migration

User = get_user_model()


class SetupWizardTests(TestCase):
    def setUp(self):
        self.client = APIClient()  # deliberately unauthenticated

    def _admin_payload(self, **overrides):
        payload = {
            'username': 'boss',
            'password': 'strong' + '-pass-123',
            'password_confirm': 'strong' + '-pass-123',
            'first_name': 'مدیر',
        }
        payload.update(overrides)
        return payload

    def test_status_reports_setup_needed_on_empty_database(self):
        response = self.client.get('/api/setup/status/')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.data['needs_setup'])

    def test_create_admin_then_everything_closes(self):
        response = self.client.post(
            '/api/setup/admin/', self._admin_payload(), format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        user = User.objects.get(username='boss')
        self.assertTrue(user.is_superuser)
        self.assertTrue(user.is_staff)
        # Status flips, and a second admin creation is refused.
        self.assertFalse(self.client.get('/api/setup/status/').data['needs_setup'])
        again = self.client.post(
            '/api/setup/admin/',
            self._admin_payload(username='second'),
            format='json',
        )
        self.assertEqual(again.status_code, 403)
        # The created admin can actually log in through the token endpoint.
        token = self.client.post(
            '/api/token/',
            {'username': 'boss', 'password': 'strong' + '-pass-123'},
            format='json',
        )
        self.assertEqual(token.status_code, 200, token.content)

    def test_create_admin_validation(self):
        short = self.client.post(
            '/api/setup/admin/',
            self._admin_payload(password='short', password_confirm='short'),
            format='json',
        )
        self.assertEqual(short.status_code, 400)
        mismatch = self.client.post(
            '/api/setup/admin/',
            self._admin_payload(password_confirm='different' + '-pass-9'),
            format='json',
        )
        self.assertEqual(mismatch.status_code, 400)
        self.assertFalse(User.objects.filter(is_superuser=True).exists())

    def test_database_endpoints_validation_and_close(self):
        bad = self.client.post(
            '/api/setup/test-database/', {'user': 'postgres'}, format='json',
        )
        self.assertEqual(bad.status_code, 400)  # database name is required
        with mock.patch(
            'api.views.setup.db_migration.test_pg_connection',
            return_value=(True, '', {}),
        ):
            ok = self.client.post(
                '/api/setup/test-database/',
                {'name': 'erp', 'user': 'postgres', 'password': 'x'},
                format='json',
            )
        self.assertEqual(ok.status_code, 200, ok.content)
        # Once an admin exists, the database setup closes too.
        self.client.post('/api/setup/admin/', self._admin_payload(), format='json')
        closed = self.client.post(
            '/api/setup/test-database/',
            {'name': 'erp', 'user': 'postgres'},
            format='json',
        )
        self.assertEqual(closed.status_code, 403)

    def test_configure_database_stages_migration(self):
        with mock.patch(
            'api.views.setup.db_migration.current_status',
            return_value={'engine': 'sqlite', 'source': 'default'},
        ), mock.patch(
            'api.views.setup.db_migration.start_migration',
            return_value={'api.invoice': 0},
        ) as start:
            response = self.client.post(
                '/api/setup/configure-database/',
                {'name': 'erp', 'user': 'postgres', 'password': 'x'},
                format='json',
            )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.data['restart_required'])
        start.assert_called_once()


class SetupProvisionViewTests(TestCase):
    """The provision endpoint: gate, validation and staging hand-off."""

    def setUp(self):
        cache.clear()  # the setup throttle bucket is shared suite-wide
        self.addCleanup(cache.clear)
        self.client = APIClient()

    def _payload(self, **overrides):
        payload = {
            'host': 'localhost',
            'port': 5432,
            'admin_user': 'postgres',
            'admin_password': 'admin' + '-secret-123',
            'name': 'mohaseb_erp',
            'user': 'mohaseb_erp',
        }
        payload.update(overrides)
        return payload

    def test_provision_stages_and_reports_restart(self):
        with mock.patch(
            'api.views.setup.db_migration.current_status',
            return_value={'engine': 'sqlite', 'source': 'default'},
        ), mock.patch(
            'api.views.setup.db_migration.provision_and_stage',
            return_value={'api.invoice': 0},
        ) as provision:
            response = self.client.post(
                '/api/setup/provision-database/', self._payload(), format='json',
            )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.data['restart_required'])
        provision.assert_called_once()
        (admin_params,), _kwargs = provision.call_args
        self.assertEqual(admin_params['admin_user'], 'postgres')
        self.assertEqual(admin_params['name'], 'mohaseb_erp')
        # The response must never carry any password back to the client.
        self.assertNotIn('password', str(response.data).lower())

    def test_provision_rejects_unsafe_identifiers_before_connecting(self):
        with mock.patch(
            'api.views.setup.db_migration.current_status',
            return_value={'engine': 'sqlite', 'source': 'default'},
        ), mock.patch(
            'api.views.setup.db_migration.provision_and_stage',
        ) as provision:
            for bad in ('bad-name', '9lives', 'a"; DROP TABLE x; --', ''):
                response = self.client.post(
                    '/api/setup/provision-database/',
                    self._payload(name=bad),
                    format='json',
                )
                self.assertEqual(response.status_code, 400, bad)
        provision.assert_not_called()

    def test_provision_requires_admin_password(self):
        response = self.client.post(
            '/api/setup/provision-database/',
            self._payload(admin_password=''),
            format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_provision_refused_when_database_is_env_managed(self):
        with mock.patch(
            'api.views.setup.db_migration.current_status',
            return_value={'engine': 'postgresql', 'source': 'env'},
        ), mock.patch(
            'api.views.setup.db_migration.provision_and_stage',
        ) as provision:
            response = self.client.post(
                '/api/setup/provision-database/', self._payload(), format='json',
            )
        self.assertEqual(response.status_code, 400)
        provision.assert_not_called()

    def test_provision_closes_once_an_admin_exists(self):
        self.client.post(
            '/api/setup/admin/',
            {
                'username': 'boss',
                'password': 'strong' + '-pass-123',
                'password_confirm': 'strong' + '-pass-123',
            },
            format='json',
        )
        response = self.client.post(
            '/api/setup/provision-database/', self._payload(), format='json',
        )
        self.assertEqual(response.status_code, 403)


class _FakeCursor:
    def __init__(self, connection):
        self.connection = connection

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, query, params=None):
        query = str(query)
        self.connection.queries.append(query)
        self.connection.last = (query, params)
        marker = self.connection.server.get('fail_on')
        if marker and query.startswith(marker):
            raise RuntimeError('boom')

    def fetchone(self):
        query, params = self.connection.last
        if 'pg_database' in query:
            return (1,) if params[0] in self.connection.server['databases'] else None
        if 'pg_roles' in query:
            return (1,) if params[0] in self.connection.server['roles'] else None
        return None

    def fetchall(self):
        return []


class _FakeConnection:
    def __init__(self, server, user):
        self.server = server
        self.user = user
        self.queries = []
        self.last = None
        self.autocommit = False
        self.closed = False

    def cursor(self):
        return _FakeCursor(self)

    def close(self):
        self.closed = True


class ProvisionDatabaseTests(TestCase):
    """db_migration.provision_database against a fake PostgreSQL."""

    def setUp(self):
        self.server = {'databases': set(), 'roles': {'postgres'}, 'fail_on': None}
        self.connections = []

        def fake_connect(**kwargs):
            connection = _FakeConnection(self.server, kwargs.get('user'))
            self.connections.append(connection)
            return connection

        patcher = mock.patch('psycopg.connect', side_effect=fake_connect)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.params = {
            'host': 'localhost',
            'port': 5432,
            'admin_user': 'postgres',
            'admin_password': 'admin' + '-secret-123',
            'name': 'mohaseb_erp',
            'user': 'mohaseb_erp',
        }

    def _all_queries(self):
        return [q for conn in self.connections for q in conn.queries]

    def test_creates_least_privilege_user_and_owned_database(self):
        app_params = db_migration.provision_database(self.params)
        queries = self._all_queries()
        create_user = next(q for q in queries if q.startswith('CREATE USER'))
        self.assertIn('"mohaseb_erp"', create_user)
        self.assertNotIn('SUPERUSER', create_user)
        self.assertNotIn('CREATEDB', create_user)
        create_db = next(q for q in queries if q.startswith('CREATE DATABASE'))
        self.assertIn('"mohaseb_erp"', create_db)
        self.assertIn('OWNER "mohaseb_erp"', create_db)
        # The generated application password: 32 chars, never the admin's.
        self.assertEqual(len(app_params['password']), 32)
        self.assertNotEqual(app_params['password'], self.params['admin_password'])
        self.assertIn(app_params['password'], create_user)
        # The fresh database was verified through the app user's own
        # connection before the params were handed back.
        self.assertTrue(
            any(c.user == 'mohaseb_erp' for c in self.connections),
        )

    def test_refuses_existing_database_and_creates_nothing(self):
        self.server['databases'].add('mohaseb_erp')
        with self.assertRaises(ValueError):
            db_migration.provision_database(self.params)
        self.assertFalse(
            any(q.startswith('CREATE') for q in self._all_queries()),
        )

    def test_refuses_existing_role_and_creates_nothing(self):
        self.server['roles'].add('mohaseb_erp')
        with self.assertRaises(ValueError):
            db_migration.provision_database(self.params)
        self.assertFalse(
            any(q.startswith('CREATE') for q in self._all_queries()),
        )

    def test_rolls_back_the_user_when_database_creation_fails(self):
        self.server['fail_on'] = 'CREATE DATABASE'
        with self.assertRaises(ValueError):
            db_migration.provision_database(self.params)
        queries = self._all_queries()
        self.assertTrue(any(q.startswith('DROP USER') for q in queries))

    def test_staging_failure_drops_what_was_provisioned(self):
        with mock.patch.object(
            db_migration, 'start_migration', side_effect=ValueError('stage failed'),
        ):
            with self.assertRaises(ValueError):
                db_migration.provision_and_stage(self.params)
        queries = self._all_queries()
        self.assertTrue(any(q.startswith('DROP DATABASE') for q in queries))
        self.assertTrue(any(q.startswith('DROP USER') for q in queries))

    def test_clean_admin_params_defaults_and_validation(self):
        params = db_migration.clean_admin_params({
            'admin_password': 'x',
            'name': 'erp_db',
        })
        self.assertEqual(params['admin_user'], 'postgres')
        self.assertEqual(params['user'], 'erp_db')  # defaults to the db name
        self.assertEqual(params['port'], 5432)
        with self.assertRaises(ValueError):
            db_migration.clean_admin_params({'name': 'erp'})
        with self.assertRaises(ValueError):
            db_migration.clean_admin_params(
                {'admin_password': 'x', 'name': 'نام فارسی'},
            )
