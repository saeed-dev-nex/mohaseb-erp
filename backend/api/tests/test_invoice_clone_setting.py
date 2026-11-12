"""The «صدور مشابه» (invoice clone) feature toggle in invoice settings.

Rules under test:
* the flag defaults to True and is readable by any authenticated user
  (the invoice list/detail pages use it to show or hide clone actions);
* only settings managers can change it.
"""

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from api.models import InvoiceSettings


class InvoiceCloneSettingTests(APITestCase):
    def setUp(self):
        self.manager = User.objects.create_user(
            username='manager', password='<redacted>', is_staff=True
        )
        self.operator = User.objects.create_user(
            username='operator', password='<redacted>'
        )

    def test_default_is_enabled_and_readable(self):
        self.client.force_authenticate(self.operator)
        response = self.client.get('/api/invoice-settings/')
        self.assertEqual(response.status_code, 200)
        self.assertIs(response.data['enable_invoice_clone'], True)

    def test_operator_cannot_change_it(self):
        self.client.force_authenticate(self.operator)
        response = self.client.patch(
            '/api/invoice-settings/update_config/',
            {'enable_invoice_clone': False},
            format='json',
        )
        self.assertEqual(response.status_code, 403)
        self.assertTrue(InvoiceSettings.load().enable_invoice_clone)

    def test_manager_can_disable_and_reenable(self):
        self.client.force_authenticate(self.manager)
        response = self.client.patch(
            '/api/invoice-settings/update_config/',
            {'enable_invoice_clone': False},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertIs(response.data['enable_invoice_clone'], False)
        self.assertFalse(InvoiceSettings.load().enable_invoice_clone)

        response = self.client.patch(
            '/api/invoice-settings/update_config/',
            {'enable_invoice_clone': True},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(InvoiceSettings.load().enable_invoice_clone)
