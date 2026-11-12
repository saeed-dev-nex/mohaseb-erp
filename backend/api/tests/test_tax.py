"""ERP phase 4 — VAT, seasonal transactions, مؤدیان queue, depreciation."""

import datetime
from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import (
    Business, Customer, FixedAsset, Invoice, JournalEntry, Product,
)


class TaxAndAssetsTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(username='tax-admin', password='admin' + '-pass-12345')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            '/api/businesses/',
            {'name': 'مالیات تست', 'template_key': 'retail', 'person_type': 'legal'},
            format='json',
        )
        assert response.status_code == 201, response.content
        self.business = Business.objects.get(name='مالیات تست')
        self.headers = {'HTTP_X_BUSINESS_ID': str(self.business.id)}
        self.customer = Customer.objects.create(
            business=self.business, name='مشتری الف', national_id='1234567890',
        )
        self.supplier = Customer.objects.create(
            business=self.business, name='تأمین‌کننده ب', party_role='supplier',
            national_id='9876543210',
        )
        # Q1 1405 ≈ 2026-03-21 .. 2026-06-21
        self.q1_date = timezone.make_aware(datetime.datetime(2026, 4, 10, 10, 0))

    def _invoice(self, total, tax=10, status='paid', when=None):
        return Invoice.objects.create(
            business=self.business, customer=self.customer,
            total_amount=Decimal(total), tax=Decimal(tax), status=status,
            date=when or self.q1_date,
        )

    def _posted_purchase(self, vat_amount=400_000):
        product = Product.objects.create(
            business=self.business, code='P-T', name='کالای مالیاتی',
        )
        created = self.client.post(
            '/api/purchases/',
            {
                'supplier': self.supplier.id, 'date': '2026-04-15',
                'vat_amount': vat_amount,
                'lines': [{'product': product.id, 'quantity': 4, 'unit_price': 1_000_000}],
            },
            format='json', **self.headers,
        )
        assert created.status_code == 201, created.content
        posted = self.client.post(
            f"/api/purchases/{created.data['id']}/post/", {}, format='json', **self.headers,
        )
        assert posted.status_code == 200, posted.content
        return posted.data

    def test_vat_report_quarter(self):
        self._invoice(10_000_000)
        self._invoice(5_000_000, status='cancelled')
        self._posted_purchase()
        report = self.client.get(
            '/api/tax/vat-report/', {'year': 1405, 'season': 1}, **self.headers,
        )
        self.assertEqual(report.status_code, 200, report.content)
        self.assertEqual(report.data['sales_count'], 1)
        self.assertEqual(int(report.data['output_vat']), 1_000_000)
        self.assertEqual(int(report.data['purchases_base']), 4_000_000)
        self.assertEqual(int(report.data['input_vat']), 400_000)
        self.assertEqual(int(report.data['payable']), 600_000)

    def test_vat_report_empty_quarter(self):
        report = self.client.get(
            '/api/tax/vat-report/', {'year': 1405, 'season': 3}, **self.headers,
        )
        self.assertEqual(int(report.data['payable']), 0)

    def test_seasonal_report_groups_by_party(self):
        self._invoice(10_000_000)
        self._posted_purchase()
        report = self.client.get(
            '/api/tax/seasonal/', {'year': 1405, 'season': 1}, **self.headers,
        )
        rows = {(r['side'], r['party_name']): r for r in report.data['rows']}
        sale = rows[('sale', 'مشتری الف')]
        self.assertEqual(sale['count'], 1)
        self.assertEqual(int(sale['amount']), 11_000_000)
        self.assertEqual(int(sale['vat']), 1_000_000)
        purchase = rows[('purchase', 'تأمین‌کننده ب')]
        self.assertEqual(int(purchase['amount']), 4_000_000)
        csv_response = self.client.get(
            '/api/tax/seasonal/', {'year': 1405, 'season': 1, 'export': 'csv'},
            **self.headers,
        )
        self.assertIn('مشتری الف', csv_response.content.decode('utf-8-sig'))

    def test_moadian_queue_flow(self):
        invoice = self._invoice(2_000_000)
        queued = self.client.post(
            '/api/moadian-submissions/queue/', {'invoice': invoice.id},
            format='json', **self.headers,
        )
        self.assertEqual(queued.status_code, 201, queued.content)
        self.assertEqual(queued.data['status'], 'queued')
        self.assertTrue(queued.data['unique_id'])
        again = self.client.post(
            '/api/moadian-submissions/queue/', {'invoice': invoice.id},
            format='json', **self.headers,
        )
        self.assertEqual(again.data['id'], queued.data['id'])
        sent = self.client.post(
            f"/api/moadian-submissions/{queued.data['id']}/mark-sent/", {},
            format='json', **self.headers,
        )
        self.assertEqual(sent.data['status'], 'sent')
        self.assertIsNotNone(sent.data['submitted_at'])

    def _asset(self, **overrides):
        payload = {
            'code': 'A-1', 'name': 'دستگاه تست', 'category': 'machinery',
            'purchase_date': '2026-03-25', 'cost': 120_000_000,
            'salvage_value': 0, 'useful_life_years': 10,
        }
        payload.update(overrides)
        created = self.client.post(
            '/api/fixed-assets/', payload, format='json', **self.headers,
        )
        assert created.status_code == 201, created.content
        return created.data

    def test_depreciation_starts_month_after_purchase(self):
        asset = self._asset()
        self.assertEqual(int(asset['monthly_depreciation']), 1_000_000)
        run1 = self.client.post(
            '/api/depreciation-runs/', {'year': 1405, 'month': 1},
            format='json', **self.headers,
        )
        self.assertEqual(run1.status_code, 201, run1.content)
        self.assertEqual(int(run1.data['total_amount']), 0)
        run2 = self.client.post(
            '/api/depreciation-runs/', {'year': 1405, 'month': 2},
            format='json', **self.headers,
        )
        self.assertEqual(int(run2.data['total_amount']), 1_000_000)
        entry = JournalEntry.objects.get(id=run2.data['journal_entry'])
        self.assertTrue(entry.is_balanced)
        self.assertEqual(entry.lines.get(debit=1_000_000).account.code, '5205')
        duplicate = self.client.post(
            '/api/depreciation-runs/', {'year': 1405, 'month': 2},
            format='json', **self.headers,
        )
        self.assertEqual(duplicate.status_code, 400)
        # deleting the run reverses the asset
        deleted = self.client.delete(f"/api/depreciation-runs/{run2.data['id']}/", **self.headers)
        self.assertEqual(deleted.status_code, 204)
        asset_after = FixedAsset.objects.get(code='A-1', business=self.business)
        self.assertEqual(asset_after.accumulated_depreciation, Decimal(0))
        self.assertEqual(asset_after.depreciated_months, 0)

    def test_depreciation_caps_at_depreciable_base(self):
        asset = self._asset(
            code='A-2', cost=1_000_000, salvage_value=400_000, useful_life_years=1,
        )
        obj = FixedAsset.objects.get(id=asset['id'])
        obj.depreciated_months = 11
        obj.accumulated_depreciation = Decimal(550_000)
        obj.save()
        run = self.client.post(
            '/api/depreciation-runs/', {'year': 1406, 'month': 1},
            format='json', **self.headers,
        )
        self.assertEqual(int(run.data['total_amount']), 50_000)
        obj.refresh_from_db()
        self.assertTrue(obj.is_fully_depreciated)
        run_next = self.client.post(
            '/api/depreciation-runs/', {'year': 1406, 'month': 2},
            format='json', **self.headers,
        )
        self.assertEqual(int(run_next.data['total_amount']), 0)

    def test_tax_settings_defaults(self):
        response = self.client.get('/api/tax/settings/', **self.headers)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(float(response.data['vat_rate']), 10.0)
