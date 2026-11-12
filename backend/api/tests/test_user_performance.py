"""Per-user performance profiles: summary + detail endpoints."""

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from ..models import Customer, Invoice, InvoiceEditRequest, InvoicePayment

User = get_user_model()


class UserPerformanceTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(username='perf-admin', password='admin' + '-pass-12345')
        self.operator = User.objects.create_user(username='perf-op', password='op' + '-pass-12345')
        self.other = User.objects.create_user(username='perf-other', password='op' + '-pass-12345')
        customer = Customer.objects.create(name='مشتری عملکرد')
        self.invoice_a = Invoice.objects.create(
            customer=customer, status='paid', total_amount=300000,
            invoice_number='INV-80001', created_by=self.operator,
        )
        self.invoice_b = Invoice.objects.create(
            customer=customer, status='pending', total_amount=200000,
            invoice_number='INV-80002', created_by=self.operator,
        )
        Invoice.objects.create(
            customer=customer, status='paid', total_amount=999000,
            invoice_number='INV-80003', created_by=self.other,
        )
        InvoicePayment.objects.create(
            invoice=self.invoice_a, amount=150000, method='cash',
            created_by=self.operator,
        )
        InvoiceEditRequest.objects.create(
            invoice=self.invoice_a, requested_by=self.operator, status='approved',
        )
        self.client = APIClient()

    def test_summary_reports_per_user_stats(self):
        self.client.force_authenticate(self.admin)
        response = self.client.get('/api/users/performance-summary/?range=all')
        self.assertEqual(response.status_code, 200, response.content)
        rows = {row['username']: row for row in response.data['users']}
        op = rows['perf-op']
        self.assertEqual(op['invoices_issued'], 2)
        self.assertEqual(op['invoices_total'], 500000)
        self.assertEqual(op['payments_recorded'], 1)
        self.assertEqual(op['payments_total'], 150000)
        self.assertEqual(rows['perf-other']['invoices_issued'], 1)

    def test_detail_profile(self):
        self.client.force_authenticate(self.admin)
        response = self.client.get(f'/api/users/{self.operator.id}/performance/?range=all')
        self.assertEqual(response.status_code, 200, response.content)
        data = response.data
        self.assertEqual(data['user']['username'], 'perf-op')
        self.assertEqual(data['stats']['invoices_issued'], 2)
        self.assertEqual(data['stats']['edit_requests'], 1)
        self.assertEqual(data['stats']['edit_requests_approved'], 1)
        self.assertEqual(len(data['monthly_series']), 6)
        current_month = data['monthly_series'][-1]
        self.assertEqual(current_month['count'], 2)
        self.assertEqual(current_month['total'], 500000)
        self.assertEqual(len(data['recent_invoices']), 2)
        self.assertEqual(len(data['recent_payments']), 1)
        self.assertEqual(data['recent_payments'][0]['invoice_number'], 'INV-80001')

    def test_non_superuser_cannot_see_performance(self):
        self.client.force_authenticate(self.operator)
        summary = self.client.get('/api/users/performance-summary/?range=all')
        self.assertEqual(summary.status_code, 403)
        detail = self.client.get(f'/api/users/{self.operator.id}/performance/?range=all')
        self.assertEqual(detail.status_code, 403)
