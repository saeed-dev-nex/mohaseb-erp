"""Stage 6: granular per-module access.

Rules under test (see api.module_access):
* no restriction row -> exactly the pre-stage-6 role behaviour;
* a row only restricts, never grants beyond the role ceiling;
* a superuser can never be restricted.
"""

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from api.models import Customer, UserModuleAccess


class ModuleAccessApiTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(username='admin', password='x')
        self.manager = User.objects.create_user(username='manager', password='x', is_staff=True)
        self.operator = User.objects.create_user(username='operator', password='x')
        Customer.objects.create(name='مشتری', phone='09120000000')

    def test_operator_without_row_keeps_legacy_access(self):
        self.client.force_authenticate(self.operator)
        self.assertEqual(self.client.get('/api/customers/').status_code, 200)
        self.assertEqual(self.client.get('/api/invoices/').status_code, 200)
        self.assertEqual(self.client.get('/api/cheques/').status_code, 200)

    def test_row_restricts_operator_module(self):
        UserModuleAccess.objects.create(user=self.operator, customers=False)
        self.client.force_authenticate(self.operator)
        self.assertEqual(self.client.get('/api/customers/').status_code, 403)
        # Untouched modules keep working.
        self.assertEqual(self.client.get('/api/invoices/').status_code, 200)

    def test_row_cannot_grant_beyond_role(self):
        # 'users' is above an operator's ceiling even when the row enables it.
        UserModuleAccess.objects.create(user=self.operator, users=True)
        self.client.force_authenticate(self.operator)
        response = self.client.get('/api/users/me/')
        self.assertNotIn('users', response.data['modules'])

    def test_manager_ceiling_includes_settings_but_not_user_administration(self):
        self.client.force_authenticate(self.manager)
        modules = self.client.get('/api/users/me/').data['modules']
        self.assertIn('settings', modules)
        self.assertNotIn('users', modules)
        self.assertNotIn('backup', modules)

    def test_superuser_bypasses_restrictions(self):
        UserModuleAccess.objects.create(
            user=self.admin, invoices=False, customers=False, cheques=False,
        )
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get('/api/customers/').status_code, 200)
        self.assertEqual(self.client.get('/api/invoices/').status_code, 200)
        modules = self.client.get('/api/users/me/').data['modules']
        self.assertIn('backup', modules)

    def test_admin_can_set_and_clear_module_access(self):
        self.client.force_authenticate(self.admin)
        url = f'/api/users/{self.operator.id}/module_access/'
        response = self.client.put(url, {'expenses': False}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data['access']['expenses'], False)
        self.assertNotIn('expenses', response.data['modules'])

        self.client.force_authenticate(self.operator)
        self.assertEqual(self.client.get('/api/expenses/').status_code, 403)

        self.client.force_authenticate(self.admin)
        response = self.client.put(url, {}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIsNone(response.data['access'])
        self.assertIn('expenses', response.data['modules'])

    def test_operator_cannot_edit_module_access(self):
        self.client.force_authenticate(self.operator)
        url = f'/api/users/{self.operator.id}/module_access/'
        self.assertEqual(self.client.put(url, {'expenses': False}, format='json').status_code, 403)
