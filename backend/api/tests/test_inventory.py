"""ERP phase 2 — inventory, purchasing, auto-journals and the sales link."""

from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from api.models import (
    Business, BusinessMembership, Customer, JournalEntry, Product,
    StockMovement,
)


class InventoryTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(username='inv-admin', password='admin' + '-pass-12345')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            '/api/businesses/',
            {'name': 'انبار تست', 'template_key': 'retail', 'person_type': 'legal'},
            format='json',
        )
        assert response.status_code == 201, response.content
        self.business = Business.objects.get(name='انبار تست')
        self.headers = {'HTTP_X_BUSINESS_ID': str(self.business.id)}
        self.supplier = Customer.objects.create(
            business=self.business, name='تأمین‌کننده تست', party_role='supplier',
        )
        self.customer = Customer.objects.create(
            business=self.business, name='مشتری تست', party_role='customer',
        )
        created = self.client.post(
            '/api/products/',
            {'code': 'P-100', 'name': 'کالای تست', 'unit': 'عدد', 'sale_price': 5000},
            format='json', **self.headers,
        )
        assert created.status_code == 201, created.content
        self.product = Product.objects.get(code='P-100', business=self.business)

    def _buy(self, quantity, unit_price, post=True):
        from datetime import timedelta

        fy = self.business.current_fiscal_year
        payload = {
            'supplier': self.supplier.id,
            'date': (fy.start_date + timedelta(days=5)).isoformat(),
            'lines': [{'product': self.product.id, 'quantity': quantity, 'unit_price': unit_price}],
        }
        created = self.client.post('/api/purchases/', payload, format='json', **self.headers)
        assert created.status_code == 201, created.content
        if post:
            posted = self.client.post(
                f"/api/purchases/{created.data['id']}/post/", {}, format='json', **self.headers,
            )
            assert posted.status_code == 200, posted.content
            return posted.data
        return created.data

    def _stock(self):
        self.product.refresh_from_db()
        return Product.objects.get(id=self.product.id).current_stock

    def test_purchase_post_moves_stock_and_writes_journal(self):
        purchase = self._buy(10, 1000)
        self.assertEqual(purchase['status'], 'posted')
        self.assertEqual(self._stock(), Decimal('10'))
        self.product.refresh_from_db()
        self.assertEqual(self.product.average_cost, Decimal('1000'))
        entry = JournalEntry.objects.get(id=purchase['journal_entry'])
        self.assertEqual(entry.status, 'posted')
        self.assertTrue(entry.is_balanced)
        self.assertEqual(entry.total_debit, Decimal('10000'))
        payable_line = entry.lines.get(credit=10000)
        self.assertEqual(payable_line.party_id, self.supplier.id)
        self.assertEqual(payable_line.account.code, '2101')

    def test_draft_purchase_moves_nothing(self):
        self._buy(7, 900, post=False)
        self.assertEqual(self._stock(), Decimal('0'))
        self.assertEqual(StockMovement.objects.count(), 0)

    def test_weighted_average_cost(self):
        self._buy(10, 1000)
        self._buy(10, 2000)
        self.product.refresh_from_db()
        self.assertEqual(self.product.average_cost, Decimal('1500'))
        self.assertEqual(self._stock(), Decimal('20'))

    def test_unpost_purchase_reverses_everything(self):
        purchase = self._buy(10, 1000)
        self._buy(10, 3000)
        unposted = self.client.post(
            f"/api/purchases/{purchase['id']}/unpost/", {}, format='json', **self.headers,
        )
        self.assertEqual(unposted.status_code, 200, unposted.content)
        self.assertEqual(self._stock(), Decimal('10'))
        self.product.refresh_from_db()
        self.assertEqual(self.product.average_cost, Decimal('3000'))
        self.assertFalse(JournalEntry.objects.filter(id=purchase['journal_entry']).exists())

    def test_purchase_numbers_increment(self):
        first = self._buy(1, 100, post=False)
        second = self._buy(1, 100, post=False)
        self.assertEqual((first['number'], second['number']), (1, 2))

    def test_sale_invoice_auto_posts_stock_and_journals(self):
        self._buy(10, 1000)
        payload = {
            'customer': self.customer.id,
            'business': self.business.id,
            'items': [
                {'product': self.product.id, 'service_title_snapshot': 'کالای تست',
                 'quantity': 2, 'main_price': 5000},
            ],
        }
        created = self.client.post('/api/invoices/', payload, format='json', **self.headers)
        self.assertEqual(created.status_code, 201, created.content)
        self.assertTrue(created.data['inventory_posted'])
        self.assertEqual(self._stock(), Decimal('8'))
        sales_entry = JournalEntry.objects.get(id=created.data['sales_journal'])
        self.assertEqual(sales_entry.total_debit, Decimal('10000'))
        self.assertEqual(
            sales_entry.lines.get(debit=10000).party_id, self.customer.id,
        )
        cogs_entry = JournalEntry.objects.get(id=created.data['cogs_journal'])
        self.assertEqual(cogs_entry.total_debit, Decimal('2000'))
        trial = self.client.get('/api/accounting/trial-balance/', **self.headers)
        self.assertTrue(trial.data['is_balanced'])

    def test_unpost_inventory_reverses_sale(self):
        self._buy(5, 1000)
        payload = {
            'customer': self.customer.id,
            'items': [
                {'product': self.product.id, 'service_title_snapshot': 'کالای تست',
                 'quantity': 1, 'main_price': 5000},
            ],
        }
        created = self.client.post('/api/invoices/', payload, format='json', **self.headers)
        self.assertEqual(created.status_code, 201, created.content)
        reversed_res = self.client.post(
            f"/api/invoices/{created.data['id']}/unpost-inventory/", {}, format='json', **self.headers,
        )
        self.assertEqual(reversed_res.status_code, 200, reversed_res.content)
        self.assertFalse(reversed_res.data['inventory_posted'])
        self.assertEqual(self._stock(), Decimal('5'))

    def test_kardex_running_balance(self):
        self._buy(10, 1000)
        adjust = self.client.post(
            '/api/inventory/adjust/',
            {'product': self.product.id, 'kind': 'out_adjust', 'quantity': '3', 'note': 'کسری انبارگردانی'},
            format='json', **self.headers,
        )
        self.assertEqual(adjust.status_code, 201, adjust.content)
        kardex = self.client.get('/api/inventory/kardex/', {'product': self.product.id}, **self.headers)
        self.assertEqual(kardex.status_code, 200, kardex.content)
        self.assertEqual(Decimal(str(kardex.data['current_stock'])), Decimal('7'))
        self.assertEqual(Decimal(str(kardex.data['rows'][-1]['balance'])), Decimal('7'))

    def test_operator_cannot_post_purchase(self):
        operator = User.objects.create_user(username='inv-op', password='op' + '-pass-12345')
        BusinessMembership.objects.create(user=operator, business=self.business, role='operator')
        purchase = self._buy(3, 100, post=False)
        self.client.force_authenticate(operator)
        posted = self.client.post(
            f"/api/purchases/{purchase['id']}/post/", {}, format='json', **self.headers,
        )
        self.assertEqual(posted.status_code, 403)
