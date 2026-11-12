"""First-run setup wizard: open only while no superuser exists."""

from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

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
