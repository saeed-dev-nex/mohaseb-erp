"""ERP phase 2.5 — professional inventory: landed costs, warehouse-aware
purchases, inter-warehouse transfers, stock counting, alerts, batch /
expiry tracking and the negative-stock guard."""

from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import (
    Business, Customer, JournalEntry, Product, StockMovement, Warehouse,
)


class InventoryProTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(
            username='invpro-admin', password='admin' + '-pass-12345',
        )
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            '/api/businesses/',
            {'name': 'انبار حرفه‌ای', 'template_key': 'retail', 'person_type': 'legal'},
            format='json',
        )
        assert response.status_code == 201, response.content
        self.business = Business.objects.get(name='انبار حرفه‌ای')
        self.headers = {'HTTP_X_BUSINESS_ID': str(self.business.id)}
        self.supplier = Customer.objects.create(
            business=self.business, name='تأمین‌کننده', party_role='supplier',
        )
        self.customer = Customer.objects.create(
            business=self.business, name='مشتری', party_role='customer',
        )
        created = self.client.post(
            '/api/products/',
            {
                'code': 'P-1', 'name': 'کالای الف', 'unit': 'عدد',
                'sale_price': 9000, 'reorder_point': 5, 'max_stock': 50,
                'min_stock': 2, 'secondary_unit': 'کارتن',
                'secondary_factor': 12, 'shelf_location': 'قفسه ۳',
            },
            format='json', **self.headers,
        )
        assert created.status_code == 201, created.content
        self.product = Product.objects.get(code='P-1', business=self.business)
        fy = self.business.current_fiscal_year
        self.date = (fy.start_date + timedelta(days=5)).isoformat()

    # -- helpers ---------------------------------------------------------
    def _buy(self, quantity=10, unit_price=1000, post=True, **extra):
        payload = {
            'supplier': self.supplier.id,
            'date': self.date,
            'lines': [{'product': self.product.id, 'quantity': quantity, 'unit_price': unit_price}],
        }
        payload.update(extra)
        created = self.client.post('/api/purchases/', payload, format='json', **self.headers)
        assert created.status_code == 201, created.content
        if post:
            posted = self.client.post(
                f"/api/purchases/{created.data['id']}/post/", {}, format='json', **self.headers,
            )
            assert posted.status_code == 200, posted.content
            return posted.data
        return created.data

    def _stock(self, warehouse=None):
        movements = StockMovement.objects.filter(product=self.product)
        if warehouse is not None:
            movements = movements.filter(warehouse=warehouse)
        return sum((m.signed_quantity for m in movements), Decimal(0))

    def _warehouse(self, name):
        created = self.client.post(
            '/api/warehouses/', {'name': name}, format='json', **self.headers,
        )
        assert created.status_code == 201, created.content
        return Warehouse.objects.get(id=created.data['id'])

    # -- product stock-control fields ------------------------------------
    def test_product_control_fields_round_trip(self):
        fetched = self.client.get(
            f'/api/products/{self.product.id}/', **self.headers,
        )
        self.assertEqual(fetched.data['reorder_point'], '5.000')
        self.assertEqual(fetched.data['secondary_unit'], 'کارتن')
        self.assertEqual(fetched.data['shelf_location'], 'قفسه ۳')

    # -- landed costs ------------------------------------------------------
    def test_extra_costs_spread_into_unit_cost_and_journal(self):
        purchase = self._buy(10, 1000, extra_costs=2000)
        # Goods 10,000 + extras 2,000 = 12,000 booked; unit cost 1,200.
        self.assertEqual(Decimal(str(purchase['total'])), Decimal('10000'))
        self.assertEqual(Decimal(str(purchase['grand_total'])), Decimal('12000'))
        line = purchase['lines'][0]
        self.assertEqual(Decimal(str(line['landed_unit_cost'])), Decimal('1200'))
        self.product.refresh_from_db()
        self.assertEqual(self.product.average_cost, Decimal('1200'))
        entry = JournalEntry.objects.get(id=purchase['journal_entry'])
        self.assertEqual(entry.total_debit, Decimal('12000'))
        self.assertTrue(entry.is_balanced)
        # Unposting clears the landed cost again.
        self.client.post(
            f"/api/purchases/{purchase['id']}/unpost/", {}, format='json', **self.headers,
        )
        from api.models import PurchaseLine

        self.assertEqual(
            PurchaseLine.objects.get(purchase_id=purchase['id']).landed_unit_cost,
            Decimal('0'),
        )

    def test_no_extra_costs_keeps_old_behaviour(self):
        purchase = self._buy(4, 2500)
        self.assertEqual(Decimal(str(purchase['grand_total'])), Decimal('10000'))
        self.product.refresh_from_db()
        self.assertEqual(self.product.average_cost, Decimal('2500'))

    # -- batch / expiry ----------------------------------------------------
    def test_batch_and_expiry_flow_to_movements(self):
        expiry = (timezone.localdate() + timedelta(days=10)).isoformat()
        payload = {
            'supplier': self.supplier.id,
            'date': self.date,
            'lines': [{
                'product': self.product.id, 'quantity': 6, 'unit_price': 1000,
                'batch_no': 'B-77', 'expiry_date': expiry,
            }],
        }
        created = self.client.post('/api/purchases/', payload, format='json', **self.headers)
        assert created.status_code == 201, created.content
        self.client.post(
            f"/api/purchases/{created.data['id']}/post/", {}, format='json', **self.headers,
        )
        movement = StockMovement.objects.get(source_type='purchase')
        self.assertEqual(movement.batch_no, 'B-77')
        self.assertEqual(movement.expiry_date.isoformat(), expiry)

    # -- warehouse-aware purchase ------------------------------------------
    def test_purchase_into_specific_warehouse(self):
        branch = self._warehouse('انبار شعبه')
        self._buy(8, 1000, warehouse=branch.id)
        self.assertEqual(self._stock(warehouse=branch), Decimal('8'))
        default_wh = Warehouse.objects.get(business=self.business, is_default=True)
        self.assertEqual(self._stock(warehouse=default_wh), Decimal('0'))

    # -- transfers -----------------------------------------------------------
    def test_transfer_moves_stock_between_warehouses(self):
        self._buy(20, 1000)
        branch = self._warehouse('انبار شعبه')
        default_wh = Warehouse.objects.get(business=self.business, is_default=True)
        created = self.client.post(
            '/api/stock-transfers/',
            {
                'date': self.date, 'from_warehouse': default_wh.id,
                'to_warehouse': branch.id,
                'lines': [{'product': self.product.id, 'quantity': 7}],
            },
            format='json', **self.headers,
        )
        assert created.status_code == 201, created.content
        posted = self.client.post(
            f"/api/stock-transfers/{created.data['id']}/post/", {}, format='json', **self.headers,
        )
        assert posted.status_code == 200, posted.content
        self.assertEqual(self._stock(warehouse=default_wh), Decimal('13'))
        self.assertEqual(self._stock(warehouse=branch), Decimal('7'))
        self.assertEqual(self._stock(), Decimal('20'))
        # Unpost restores.
        self.client.post(
            f"/api/stock-transfers/{created.data['id']}/unpost/", {}, format='json', **self.headers,
        )
        self.assertEqual(self._stock(warehouse=branch), Decimal('0'))

    def test_transfer_same_warehouse_rejected(self):
        default_wh = Warehouse.objects.get(business=self.business, is_default=True)
        created = self.client.post(
            '/api/stock-transfers/',
            {
                'date': self.date, 'from_warehouse': default_wh.id,
                'to_warehouse': default_wh.id,
                'lines': [{'product': self.product.id, 'quantity': 1}],
            },
            format='json', **self.headers,
        )
        self.assertEqual(created.status_code, 400)

    # -- stock counting -------------------------------------------------------
    def test_stock_count_applies_variances(self):
        self._buy(10, 1000)
        created = self.client.post(
            '/api/stock-counts/', {'date': self.date}, format='json', **self.headers,
        )
        assert created.status_code == 201, created.content
        count_id = created.data['id']
        line = next(
            row for row in created.data['lines'] if row['product'] == self.product.id
        )
        self.assertEqual(Decimal(str(line['system_qty'])), Decimal('10'))
        saved = self.client.put(
            f'/api/stock-counts/{count_id}/lines/',
            {'lines': [{'id': line['id'], 'counted_qty': 8}]},
            format='json', **self.headers,
        )
        assert saved.status_code == 200, saved.content
        applied = self.client.post(
            f'/api/stock-counts/{count_id}/apply/', {}, format='json', **self.headers,
        )
        assert applied.status_code == 200, applied.content
        self.assertEqual(applied.data['adjusted_lines'], 1)
        self.assertEqual(self._stock(), Decimal('8'))
        adjust = StockMovement.objects.get(source_type='stock_count')
        self.assertEqual(adjust.kind, 'out_adjust')
        self.assertEqual(adjust.quantity, Decimal('2'))

    # -- alerts ---------------------------------------------------------------
    def test_alerts_low_stock_and_suggestion(self):
        self._buy(4, 1000)  # below reorder_point 5, target max_stock 50
        alerts = self.client.get('/api/inventory/alerts/', **self.headers)
        assert alerts.status_code == 200, alerts.content
        low = alerts.data['low_stock']
        self.assertEqual(len(low), 1)
        self.assertEqual(low[0]['product'], self.product.id)
        self.assertEqual(Decimal(str(low[0]['suggested_qty'])), Decimal('46'))

    def test_alerts_expiring_batch(self):
        expiry = (timezone.localdate() + timedelta(days=5)).isoformat()
        payload = {
            'supplier': self.supplier.id,
            'date': self.date,
            'lines': [{
                'product': self.product.id, 'quantity': 3, 'unit_price': 1000,
                'batch_no': 'EXP-1', 'expiry_date': expiry,
            }],
        }
        created = self.client.post('/api/purchases/', payload, format='json', **self.headers)
        self.client.post(
            f"/api/purchases/{created.data['id']}/post/", {}, format='json', **self.headers,
        )
        alerts = self.client.get('/api/inventory/alerts/', **self.headers)
        self.assertEqual(len(alerts.data['expiring']), 1)
        self.assertEqual(alerts.data['expiring'][0]['batch_no'], 'EXP-1')
        self.assertFalse(alerts.data['expiring'][0]['expired'])

    def test_alerts_dead_stock(self):
        self._buy(9, 1000)
        alerts = self.client.get('/api/inventory/alerts/', **self.headers)
        dead_ids = [row['product'] for row in alerts.data['dead_stock']]
        self.assertIn(self.product.id, dead_ids)

    # -- negative-stock guard ---------------------------------------------------
    def _set_guard(self, on):
        response = self.client.put(
            '/api/inventory/settings/', {'block_negative_stock': on},
            format='json', **self.headers,
        )
        assert response.status_code == 200, response.content

    def test_guard_off_allows_negative_adjust(self):
        response = self.client.post(
            '/api/inventory/adjust/',
            {'product': self.product.id, 'kind': 'out_adjust', 'quantity': 3},
            format='json', **self.headers,
        )
        self.assertEqual(response.status_code, 201)

    def test_guard_on_blocks_negative_adjust(self):
        self._set_guard(True)
        response = self.client.post(
            '/api/inventory/adjust/',
            {'product': self.product.id, 'kind': 'out_adjust', 'quantity': 3},
            format='json', **self.headers,
        )
        self.assertEqual(response.status_code, 400)

    def test_guard_on_blocks_overselling_invoice(self):
        self._set_guard(True)
        self._buy(2, 1000)
        payload = {
            'customer': self.customer.id,
            'business': self.business.id,
            'items': [
                {'product': self.product.id, 'service_title_snapshot': 'کالای الف',
                 'quantity': 5, 'main_price': 9000},
            ],
        }
        created = self.client.post('/api/invoices/', payload, format='json', **self.headers)
        self.assertEqual(created.status_code, 400, created.content)
        self.assertEqual(self._stock(), Decimal('2'))

    # -- kardex value ------------------------------------------------------------
    def test_kardex_value_and_warehouse_filter(self):
        self._buy(10, 1000)
        kardex = self.client.get(
            f'/api/inventory/kardex/?product={self.product.id}', **self.headers,
        )
        assert kardex.status_code == 200, kardex.content
        self.assertEqual(Decimal(str(kardex.data['stock_value'])), Decimal('10000'))
        self.assertEqual(
            Decimal(str(kardex.data['rows'][-1]['balance_value'])), Decimal('10000'),
        )
        branch = self._warehouse('انبار خالی')
        empty = self.client.get(
            f'/api/inventory/kardex/?product={self.product.id}&warehouse={branch.id}',
            **self.headers,
        )
        self.assertEqual(empty.data['rows'], [])
