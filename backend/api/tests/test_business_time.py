"""Iranian date boundaries use isolated fixtures, never the host clock or database."""

from datetime import date, datetime, timezone as datetime_timezone
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import override_settings
from rest_framework.test import APITestCase

from api.models import Invoice
from api.services.reminders import build_reminders


@override_settings(TIME_ZONE='Asia/Tehran')
class BusinessTimeTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user(username='time-review')

    def setUp(self):
        self.client.force_authenticate(self.user)

    def test_reminders_and_overdue_use_tehran_day_after_utc_evening(self):
        now = datetime(2026, 10, 22, 21, 30, tzinfo=datetime_timezone.utc)
        invoice = Invoice.objects.create(total_amount=100, due_date=date(2026, 10, 22))
        with patch('django.utils.timezone.now', return_value=now):
            digest = build_reminders()
            response = self.client.get('/api/invoices/overdue/')
        self.assertEqual(digest['today'], '2026-10-23')
        self.assertEqual([row['id'] for row in digest['overdue_invoices']], [invoice.pk])
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row['id'] for row in response.data], [invoice.pk])

    def test_invoice_date_filter_uses_local_day(self):
        invoice = Invoice.objects.create(
            total_amount=100, date=datetime(2026, 10, 22, 21, 30, tzinfo=datetime_timezone.utc),
        )
        response = self.client.get('/api/invoices/', {'date_from': '2026-10-23', 'date_to': '2026-10-23'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row['id'] for row in response.data], [invoice.pk])

    def test_dashboard_and_report_share_local_month_boundary(self):
        # 2026-10-31 21:30 UTC is already 2026-11-01 01:00 in Tehran —
        # 10 Aban 1405. Both monthly series bucket by the JALALI month,
        # so the invoice lands in 1405-08 on both.
        now = datetime(2026, 10, 31, 21, 30, tzinfo=datetime_timezone.utc)
        Invoice.objects.create(total_amount=100, commission_total=Decimal(10), status='paid', date=now)
        with patch('django.utils.timezone.now', return_value=now):
            dashboard = self.client.get('/api/dashboard/stats/')
            report = self.client.get('/api/invoices/report/')
        self.assertEqual(dashboard.status_code, 200)
        self.assertEqual(dashboard.data['monthly_revenue'][-1]['month'], '1405-08')
        self.assertEqual(dashboard.data['monthly_revenue'][-1]['label'], 'آبان ۱۴۰۵')
        self.assertEqual(dashboard.data['monthly_revenue'][-1]['revenue'], 10)
        self.assertEqual(report.status_code, 200)
        self.assertEqual(report.data['monthly'][0]['month'], '1405-08')
        self.assertEqual(report.data['monthly'][0]['label'], 'آبان ۱۴۰۵')
