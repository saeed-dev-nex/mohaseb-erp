"""API tests: authentication, invoice creation, payments and permissions."""

from django.contrib.auth.models import User
from django.core.cache import cache
from rest_framework.test import APITestCase

from api.models import Customer, Invoice


class AuthenticatedTestCase(APITestCase):
    def setUp(self):
        cache.clear()  # throttle counters must not leak between tests
        self.operator = User.objects.create_user(username='operator', password='test-pass-123')
        self.manager = User.objects.create_user(username='manager', password='test-pass-123', is_staff=True)
        self.admin = User.objects.create_superuser(username='admin', password='test-pass-123')

    def login(self, username='operator', password='test-pass-123'):
        response = self.client.post('/api/token/', {'username': username, 'password': password}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        token = response.data['access']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        return response.data


class AuthenticationTests(AuthenticatedTestCase):
    def test_customers_list_requires_authentication(self):
        response = self.client.get('/api/customers/')
        self.assertEqual(response.status_code, 401)

    def test_invoices_list_requires_authentication(self):
        response = self.client.get('/api/invoices/')
        self.assertEqual(response.status_code, 401)

    def test_login_returns_access_and_refresh_tokens(self):
        data = self.login()
        self.assertIn('access', data)
        self.assertIn('refresh', data)

    def test_login_with_wrong_password_is_rejected(self):
        response = self.client.post('/api/token/', {'username': 'operator', 'password': 'wrong'}, format='json')
        self.assertEqual(response.status_code, 401)

    def test_refresh_rotates_refresh_token_and_blacklists_old_one(self):
        data = self.login()
        old_refresh = data['refresh']
        response = self.client.post('/api/token/refresh/', {'refresh': old_refresh}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIn('refresh', response.data)
        self.assertNotEqual(response.data['refresh'], old_refresh)
        # The rotated-out token must no longer work.
        replay = self.client.post('/api/token/refresh/', {'refresh': old_refresh}, format='json')
        self.assertEqual(replay.status_code, 401)


class LoginThrottleTests(AuthenticatedTestCase):
    """Uses the production rate from settings: ``login = 5/min``."""

    def test_login_is_throttled_after_repeated_attempts(self):
        for _ in range(5):
            response = self.client.post('/api/token/', {'username': 'operator', 'password': 'wrong'}, format='json')
            self.assertEqual(response.status_code, 401)
        response = self.client.post('/api/token/', {'username': 'operator', 'password': 'wrong'}, format='json')
        self.assertEqual(response.status_code, 429)


class InvoiceApiTests(AuthenticatedTestCase):
    def setUp(self):
        super().setUp()
        self.login()
        self.customer = Customer.objects.create(name='مشتری API')

    def invoice_payload(self, **overrides):
        payload = {
            'customer': self.customer.id,
            'status': 'pending',
            'items': [
                {'service_title_snapshot': 'خدمت یک', 'quantity': 2,
                 'main_price': 10000, 'extra_price': 5000, 'commission': 1000},
                {'service_title_snapshot': 'خدمت دو', 'quantity': 1,
                 'main_price': 20000, 'extra_price': 0, 'commission': 0},
            ],
        }
        payload.update(overrides)
        return payload

    def test_create_invoice_calculates_total_and_assigns_number(self):
        response = self.client.post('/api/invoices/', self.invoice_payload(), format='json')
        self.assertEqual(response.status_code, 201, response.content)
        # (10000+5000)*2 + 20000*1 = 50000 (DecimalField serializes as str)
        self.assertEqual(int(response.data['total_amount']), 50000)
        self.assertTrue(response.data['invoice_number'].startswith('INV-'))

    def test_partial_payment_keeps_invoice_pending(self):
        invoice = Invoice.objects.create(customer=self.customer, total_amount=50000, status='pending')
        response = self.client.post(f'/api/invoices/{invoice.id}/payments/', {'amount': 20000, 'method': 'cash'}, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'pending')

    def test_full_payment_marks_invoice_paid(self):
        invoice = Invoice.objects.create(customer=self.customer, total_amount=50000, status='pending')
        response = self.client.post(f'/api/invoices/{invoice.id}/payments/', {'amount': 50000, 'method': 'card'}, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'paid')

    def test_overpayment_is_rejected(self):
        invoice = Invoice.objects.create(customer=self.customer, total_amount=50000, status='pending')
        response = self.client.post(f'/api/invoices/{invoice.id}/payments/', {'amount': 60000, 'method': 'cash'}, format='json')
        self.assertEqual(response.status_code, 400)

    def test_mark_paid_creates_covering_payment(self):
        invoice = Invoice.objects.create(customer=self.customer, total_amount=30000, status='pending')
        response = self.client.post(f'/api/invoices/{invoice.id}/mark_paid/')
        self.assertEqual(response.status_code, 200, response.content)
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'paid')
        self.assertEqual(invoice.payments.count(), 1)
        self.assertEqual(invoice.payments.first().amount, 30000)


class PermissionTests(AuthenticatedTestCase):
    def test_backup_download_is_superuser_only(self):
        self.login('operator')
        response = self.client.get('/api/backup/download/')
        self.assertEqual(response.status_code, 403)

    def test_backup_download_works_for_superuser(self):
        self.login('admin')
        response = self.client.get('/api/backup/download/')
        self.assertEqual(response.status_code, 200)

    def test_operator_cannot_read_invoice_history(self):
        invoice = Invoice.objects.create(total_amount=1000, status='pending')
        self.login('operator')
        response = self.client.get(f'/api/invoices/{invoice.id}/history/')
        self.assertEqual(response.status_code, 403)

    def test_manager_can_read_invoice_history(self):
        invoice = Invoice.objects.create(total_amount=1000, status='pending')
        self.login('manager')
        response = self.client.get(f'/api/invoices/{invoice.id}/history/')
        self.assertEqual(response.status_code, 200)
