"""Stage 4: due-date reminders digest, command, webhook and tax-id validation."""

import io
from datetime import date, timedelta
from decimal import Decimal
from unittest import mock

from django.contrib.auth.models import User
from django.core.cache import cache
from django.core.management import call_command
from rest_framework.test import APITestCase

from api.models import Cheque, Customer, Invoice, InvoicePayment
from api.services.reminders import build_reminders, format_digest

TODAY = date.today()


class RemindersSeed(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username='reminder', password='test-pass-123')
        token = self.client.post('/api/token/', {'username': 'reminder', 'password': 'test-pass-123'}, format='json')
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.data['access']}")
        self.customer = Customer.objects.create(name='مشتری تست')

        self.overdue = Invoice.objects.create(
            customer=self.customer, status='pending', total_amount=Decimal('100000'),
            due_date=TODAY - timedelta(days=5))
        InvoicePayment.objects.create(invoice=self.overdue, amount=Decimal('30000'), created_by=self.user)
        self.due_soon = Invoice.objects.create(
            customer=self.customer, status='pending', total_amount=Decimal('40000'),
            due_date=TODAY + timedelta(days=3))
        self.far = Invoice.objects.create(
            customer=self.customer, status='pending', total_amount=Decimal('90000'),
            due_date=TODAY + timedelta(days=40))
        Invoice.objects.create(
            customer=self.customer, status='paid', total_amount=Decimal('10000'),
            due_date=TODAY - timedelta(days=30))

        Cheque.objects.create(customer=self.customer, cheque_number='111', bank_name='ملی',
                              amount=Decimal('50000'), due_date=TODAY + timedelta(days=2), status='pending')
        Cheque.objects.create(customer=self.customer, cheque_number='222', bank_name='ملت',
                              amount=Decimal('70000'), due_date=TODAY - timedelta(days=1), status='pending')
        Cheque.objects.create(customer=self.customer, cheque_number='333', bank_name='صادرات',
                              amount=Decimal('80000'), due_date=TODAY - timedelta(days=20), status='bounced')
        Cheque.objects.create(customer=self.customer, cheque_number='444', bank_name='ملی',
                              amount=Decimal('60000'), due_date=TODAY + timedelta(days=1), status='passed')


class RemindersServiceTests(RemindersSeed):
    def test_digest_grouping_and_totals(self):
        digest = build_reminders(today=TODAY, within_days=7)
        totals = digest['totals']
        self.assertEqual(totals['overdue_invoices_count'], 1)
        self.assertEqual(totals['overdue_invoices_amount'], 70000)  # 100000 - 30000 paid
        self.assertEqual(digest['overdue_invoices'][0]['days'], -5)
        self.assertEqual(totals['due_soon_invoices_count'], 1)
        self.assertEqual(totals['due_soon_invoices_amount'], 40000)
        self.assertEqual(totals['cheques_due_count'], 1)
        self.assertEqual(totals['cheques_due_amount'], 50000)
        self.assertEqual(totals['cheques_overdue_count'], 1)
        self.assertEqual(totals['bounced_cheques_count'], 1)
        self.assertEqual(totals['bounced_cheques_amount'], 80000)

    def test_digest_text_mentions_key_items(self):
        text = format_digest(build_reminders(today=TODAY, within_days=7))
        self.assertIn('سررسیدگذشته', text)
        self.assertIn(self.overdue.invoice_number, text)
        self.assertIn('برگشتی', text)

    def test_endpoint(self):
        response = self.client.get('/api/dashboard/reminders/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['totals']['overdue_invoices_count'], 1)
        narrowed = self.client.get('/api/dashboard/reminders/?days=1')
        self.assertEqual(narrowed.data['totals']['due_soon_invoices_count'], 0)
        self.assertEqual(narrowed.data['totals']['cheques_due_count'], 0)


class DueRemindersCommandTests(RemindersSeed):
    def test_command_prints_digest(self):
        out = io.StringIO()
        call_command('due_reminders', stdout=out)
        text = out.getvalue()
        self.assertIn('یادآوری سررسید', text)
        self.assertIn(self.due_soon.invoice_number, text)

    def test_command_posts_webhook(self):
        out = io.StringIO()

        class FakeResponse:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

        with mock.patch('api.management.commands.due_reminders.urllib.request.urlopen', return_value=FakeResponse()) as opener:
            call_command('due_reminders', webhook_url='https://example.test/hook', stdout=out)
        self.assertTrue(opener.called)
        payload = opener.call_args[0][0].data.decode('utf-8')
        self.assertIn('یادآوری سررسید', payload)
        self.assertIn('Webhook delivered', out.getvalue())

    def test_command_survives_dead_webhook(self):
        out, err = io.StringIO(), io.StringIO()
        with mock.patch('api.management.commands.due_reminders.urllib.request.urlopen', side_effect=OSError('down')):
            call_command('due_reminders', webhook_url='https://example.test/hook', stdout=out, stderr=err)
        self.assertIn('یادآوری سررسید', out.getvalue())
        self.assertIn('Webhook delivery failed', err.getvalue())


class TaxIdValidationTests(APITestCase):
    def setUp(self):
        cache.clear()
        User.objects.create_user(username='taxer', password='test-pass-123', is_staff=True)
        token = self.client.post('/api/token/', {'username': 'taxer', 'password': 'test-pass-123'}, format='json')
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.data['access']}")

    def test_valid_national_code_accepted(self):
        response = self.client.post('/api/customers/', {'name': 'الف', 'national_id': '0499370899'}, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.data['national_id'], '0499370899')

    def test_persian_digits_normalized_and_accepted(self):
        response = self.client.post('/api/customers/', {'name': 'ب', 'national_id': '۰۴۹۹۳۷۰۸۹۹'}, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.data['national_id'], '0499370899')

    def test_bad_checksum_rejected(self):
        response = self.client.post('/api/customers/', {'name': 'ج', 'national_id': '0499370890'}, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('national_id', response.data)

    def test_repeated_digits_rejected(self):
        response = self.client.post('/api/customers/', {'name': 'د', 'national_id': '1111111111'}, format='json')
        self.assertEqual(response.status_code, 400)

    def test_legal_identifier_format(self):
        ok = self.client.post('/api/customers/', {'name': 'شرکت', 'national_id': '14003194286'}, format='json')
        self.assertEqual(ok.status_code, 201, ok.content)
        bad = self.client.post('/api/customers/', {'name': 'شرکت۲', 'national_id': '12345'}, format='json')
        self.assertEqual(bad.status_code, 400)

    def test_blank_identifier_still_allowed(self):
        response = self.client.post('/api/customers/', {'name': 'بدون شناسه', 'national_id': ''}, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        self.assertIsNone(response.data['national_id'])
