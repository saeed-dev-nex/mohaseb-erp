"""Regression tests for the 2026-11-13 main review fixes.

Covers: cross-business foreign-key validation (journal lines, purchase
lines/supplier, invoice items, account parents), header-less legacy
listings restricted to the caller's own businesses, write-role checks
on invoice inventory actions and warehouses, payroll guards (negative
inputs, finalized-period edits), setup-endpoint throttling, and the
ChatConsumer string/int user_id fix.
"""

import asyncio
from datetime import timedelta

from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TestCase, TransactionTestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from api.models import (
    Account, Business, BusinessMembership, Customer, Product, Warehouse,
)
from api.routing import websocket_urlpatterns

PW = 'review' + '-pass-12345'


def make_business(client, name, template='retail'):
    response = client.post(
        '/api/businesses/',
        {'name': name, 'template_key': template, 'person_type': 'legal'},
        format='json',
    )
    assert response.status_code == 201, response.content
    return Business.objects.get(name=name)


class TwoBusinessFixture(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(username='rev-admin', password=PW)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.biz_a = make_business(self.client, 'کسب‌وکار الف')
        self.biz_b = make_business(self.client, 'کسب‌وکار ب')
        self.headers_a = {'HTTP_X_BUSINESS_ID': str(self.biz_a.id)}
        self.headers_b = {'HTTP_X_BUSINESS_ID': str(self.biz_b.id)}
        self.customer_a = Customer.objects.create(
            business=self.biz_a, name='مشتری الف', party_role='customer')
        self.customer_b = Customer.objects.create(
            business=self.biz_b, name='مشتری ب', party_role='customer')
        self.supplier_a = Customer.objects.create(
            business=self.biz_a, name='تأمین‌کننده الف', party_role='supplier')
        self.supplier_b = Customer.objects.create(
            business=self.biz_b, name='تأمین‌کننده ب', party_role='supplier')
        self.product_a = Product.objects.create(
            business=self.biz_a, code='PA-1', name='کالای الف', sale_price=1000)
        self.product_b = Product.objects.create(
            business=self.biz_b, code='PB-1', name='کالای ب', sale_price=1000)


class CrossBusinessValidationTests(TwoBusinessFixture):
    def test_journal_line_with_foreign_account_rejected(self):
        own = Account.objects.filter(business=self.biz_a, level__gte=3).first()
        foreign = Account.objects.filter(business=self.biz_b, level__gte=3).first()
        fy = self.biz_a.current_fiscal_year
        payload = {
            'date': fy.start_date.isoformat(),
            'description': 'سند آزمایشی',
            'lines': [
                {'account': own.id, 'debit': 1000, 'credit': 0},
                {'account': foreign.id, 'debit': 0, 'credit': 1000},
            ],
        }
        response = self.client.post(
            '/api/journal-entries/', payload, format='json', **self.headers_a)
        self.assertEqual(response.status_code, 400, response.content)

    def test_journal_line_with_foreign_party_rejected(self):
        accounts = list(Account.objects.filter(business=self.biz_a, level__gte=3)[:2])
        fy = self.biz_a.current_fiscal_year
        payload = {
            'date': fy.start_date.isoformat(),
            'description': 'سند آزمایشی',
            'lines': [
                {'account': accounts[0].id, 'debit': 1000, 'credit': 0,
                 'party': self.customer_b.id},
                {'account': accounts[1].id, 'debit': 0, 'credit': 1000},
            ],
        }
        response = self.client.post(
            '/api/journal-entries/', payload, format='json', **self.headers_a)
        self.assertEqual(response.status_code, 400, response.content)

    def test_purchase_with_foreign_product_rejected(self):
        fy = self.biz_a.current_fiscal_year
        payload = {
            'supplier': self.supplier_a.id,
            'date': (fy.start_date + timedelta(days=3)).isoformat(),
            'lines': [{'product': self.product_b.id, 'quantity': 1, 'unit_price': 500}],
        }
        response = self.client.post(
            '/api/purchases/', payload, format='json', **self.headers_a)
        self.assertEqual(response.status_code, 400, response.content)

    def test_purchase_update_with_foreign_supplier_rejected(self):
        fy = self.biz_a.current_fiscal_year
        payload = {
            'supplier': self.supplier_a.id,
            'date': (fy.start_date + timedelta(days=3)).isoformat(),
            'lines': [{'product': self.product_a.id, 'quantity': 1, 'unit_price': 500}],
        }
        created = self.client.post(
            '/api/purchases/', payload, format='json', **self.headers_a)
        self.assertEqual(created.status_code, 201, created.content)
        response = self.client.patch(
            f"/api/purchases/{created.data['id']}/",
            {'supplier': self.supplier_b.id}, format='json', **self.headers_a)
        self.assertEqual(response.status_code, 400, response.content)

    def test_invoice_item_with_foreign_product_rejected(self):
        payload = {
            'customer': self.customer_a.id,
            'items': [
                {'product': self.product_b.id, 'service_title_snapshot': 'کالای ب',
                 'quantity': 1, 'main_price': 1000},
            ],
        }
        response = self.client.post(
            '/api/invoices/', payload, format='json', **self.headers_a)
        self.assertEqual(response.status_code, 400, response.content)

    def test_account_parent_cannot_move_cross_business(self):
        own = Account.objects.filter(business=self.biz_a, level__gte=3).first()
        foreign_parent = Account.objects.filter(business=self.biz_b, level=1).first()
        response = self.client.patch(
            f'/api/accounts/{own.id}/', {'parent': foreign_parent.id},
            format='json', **self.headers_a)
        self.assertEqual(response.status_code, 400, response.content)

    def test_account_level_is_not_writable(self):
        own = Account.objects.filter(business=self.biz_a, level__gte=3).first()
        original_level = own.level
        response = self.client.patch(
            f'/api/accounts/{own.id}/', {'level': 1},
            format='json', **self.headers_a)
        self.assertEqual(response.status_code, 200, response.content)
        own.refresh_from_db()
        self.assertEqual(own.level, original_level)


class LegacyScopingTests(TwoBusinessFixture):
    def setUp(self):
        super().setUp()
        self.member = User.objects.create_user(username='rev-member', password=PW)
        BusinessMembership.objects.create(
            user=self.member, business=self.biz_a, role='owner')
        self.member_client = APIClient()
        self.member_client.force_authenticate(self.member)

    def test_customer_list_without_header_hides_other_business(self):
        response = self.member_client.get('/api/customers/')
        self.assertEqual(response.status_code, 200, response.content)
        names = [row['name'] for row in response.data]
        self.assertIn('مشتری الف', names)
        self.assertNotIn('مشتری ب', names)

    def test_customer_detail_of_other_business_is_404(self):
        response = self.member_client.get(f'/api/customers/{self.customer_b.id}/')
        self.assertEqual(response.status_code, 404, response.content)

    def test_invoice_list_without_header_hides_other_business(self):
        from api.models import Invoice

        Invoice.objects.create(
            customer=self.customer_a, business=self.biz_a,
            invoice_number='INV-A-1', status='pending', total_amount=1000)
        Invoice.objects.create(
            customer=self.customer_b, business=self.biz_b,
            invoice_number='INV-B-1', status='pending', total_amount=1000)
        response = self.member_client.get('/api/invoices/')
        self.assertEqual(response.status_code, 200, response.content)
        numbers = [row['invoice_number'] for row in response.data]
        self.assertIn('INV-A-1', numbers)
        self.assertNotIn('INV-B-1', numbers)


class InventoryRoleTests(TwoBusinessFixture):
    def setUp(self):
        super().setUp()
        self.operator = User.objects.create_user(username='rev-op', password=PW)
        BusinessMembership.objects.create(
            user=self.operator, business=self.biz_a, role='operator')
        self.op_client = APIClient()
        self.op_client.force_authenticate(self.operator)
        self.warehouse = Warehouse.objects.create(business=self.biz_a, name='انبار اصلی')

    def test_operator_cannot_update_warehouse(self):
        response = self.op_client.patch(
            f'/api/warehouses/{self.warehouse.id}/', {'name': 'نام تازه'},
            format='json', **self.headers_a)
        self.assertEqual(response.status_code, 403, response.content)

    def test_operator_cannot_unpost_invoice_inventory(self):
        # Stock the product and sell one, as the superuser.
        fy = self.biz_a.current_fiscal_year
        purchase = self.client.post(
            '/api/purchases/',
            {'supplier': self.supplier_a.id,
             'date': (fy.start_date + timedelta(days=2)).isoformat(),
             'lines': [{'product': self.product_a.id, 'quantity': 5, 'unit_price': 700}]},
            format='json', **self.headers_a)
        self.assertEqual(purchase.status_code, 201, purchase.content)
        posted = self.client.post(
            f"/api/purchases/{purchase.data['id']}/post/", {}, format='json', **self.headers_a)
        self.assertEqual(posted.status_code, 200, posted.content)
        sale = self.client.post(
            '/api/invoices/',
            {'customer': self.customer_a.id,
             'items': [{'product': self.product_a.id,
                        'service_title_snapshot': 'کالای الف',
                        'quantity': 1, 'main_price': 1000}]},
            format='json', **self.headers_a)
        self.assertEqual(sale.status_code, 201, sale.content)
        self.assertTrue(sale.data['inventory_posted'])

        response = self.op_client.post(
            f"/api/invoices/{sale.data['id']}/unpost-inventory/", {},
            format='json', **self.headers_a)
        self.assertEqual(response.status_code, 403, response.content)


class PayrollGuardTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(username='rev-pay-admin', password=PW)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.business = make_business(self.client, 'حقوق بازبینی', template='general')
        self.headers = {'HTTP_X_BUSINESS_ID': str(self.business.id)}
        from api.models import Staff

        staff = Staff.objects.create(name='کارمند بازبینی')
        profile = self.client.post(
            '/api/employment-profiles/',
            {'staff': staff.id, 'personnel_code': '2001',
             'national_id': '0012345679', 'insurance_number': '87654321',
             'bank_iban': 'IR060570000000000000000002',
             'base_salary': 20_000_000, 'is_insured': True},
            format='json', **self.headers)
        assert profile.status_code == 201, profile.content
        period = self.client.post(
            '/api/payroll-periods/', {'year': 1405, 'month': 2},
            format='json', **self.headers)
        assert period.status_code == 201, period.content
        self.period_id = period.data['id']
        generated = self.client.post(
            f'/api/payroll-periods/{self.period_id}/generate/', {},
            format='json', **self.headers)
        assert generated.status_code == 200, generated.content
        slips = self.client.get(
            f'/api/payroll-periods/{self.period_id}/payslips/', **self.headers)
        self.payslip_id = slips.data[0]['id']

    def test_negative_overtime_rejected(self):
        response = self.client.patch(
            f'/api/payslips/{self.payslip_id}/', {'overtime_hours': -2},
            format='json', **self.headers)
        self.assertEqual(response.status_code, 400, response.content)

    def test_finalized_period_cannot_be_moved(self):
        finalized = self.client.post(
            f'/api/payroll-periods/{self.period_id}/finalize/', {},
            format='json', **self.headers)
        self.assertEqual(finalized.status_code, 200, finalized.content)
        response = self.client.patch(
            f'/api/payroll-periods/{self.period_id}/', {'month': 3},
            format='json', **self.headers)
        self.assertEqual(response.status_code, 400, response.content)


class SetupThrottleTests(TestCase):
    def tearDown(self):
        cache.clear()

    def test_setup_test_database_is_throttled(self):
        client = APIClient()
        statuses = []
        for _ in range(21):
            response = client.post(
                '/api/setup/test-database/',
                {'host': '', 'port': 'x', 'name': '', 'user': '', 'password': ''},
                format='json', REMOTE_ADDR='10.99.99.99')
            statuses.append(response.status_code)
        self.assertIn(429, statuses)
        self.assertNotIn(429, statuses[:-1])


class ChatDirectMessageTests(TransactionTestCase):
    def setUp(self):
        self.sender = User.objects.create_user(username='chat-sender', password=PW)
        self.recipient = User.objects.create_user(username='chat-recipient', password=PW)

    def _connect(self, user):
        token = str(AccessToken.for_user(user))
        return WebsocketCommunicator(
            URLRouter(websocket_urlpatterns),
            '/ws/chat/',
            subprotocols=['mohaseb-chat', token],
        )

    def test_direct_message_is_delivered_over_websocket(self):
        async def run():
            recipient_ws = self._connect(self.recipient)
            self.assertTrue((await recipient_ws.connect())[0])
            await recipient_ws.receive_json_from(timeout=2)  # connected event

            client = APIClient()
            client.force_authenticate(self.sender)
            loop = asyncio.get_running_loop()

            def _send():
                return client.post(
                    '/api/chat/',
                    {'recipient': self.recipient.id, 'text': 'سلام مستقیم'},
                    format='json',
                )

            response = await loop.run_in_executor(None, _send)
            self.assertEqual(response.status_code, 201, response.content)

            # Presence events from the connect may arrive first; read
            # until the message frame shows up.
            for _ in range(5):
                frame = await recipient_ws.receive_json_from(timeout=3)
                if frame.get('type') == 'message':
                    self.assertEqual(frame['message']['recipient'], self.recipient.id)
                    self.assertEqual(frame['message']['text'], 'سلام مستقیم')
                    break
            else:
                self.fail('direct message was not delivered over the websocket')
            await recipient_ws.disconnect()

        asyncio.new_event_loop().run_until_complete(run())
