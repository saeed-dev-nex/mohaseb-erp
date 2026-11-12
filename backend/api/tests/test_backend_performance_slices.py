"""Regression coverage for bounded backend list and financial queries."""

from datetime import timedelta

from django.contrib.auth.models import User
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APITestCase

from api.models import (
    Cheque,
    ChatMessage,
    Customer,
    Expense,
    ExpenseCategory,
    Invoice,
    InvoiceItem,
    InvoicePayment,
    Service,
    Staff,
    VehicleType,
)


class BackendPerformanceSliceTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='slice-user', password='fixture')
        self.other_user = User.objects.create_user(username='slice-other', password='fixture')
        self.client.force_authenticate(self.user)

    def assert_paginated_envelope(self, response, expected_count=None):
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(set(response.data), {'count', 'next', 'previous', 'results'})
        if expected_count is not None:
            self.assertEqual(response.data['count'], expected_count)

    def test_requested_list_endpoints_paginate_without_changing_legacy_arrays(self):
        category = ExpenseCategory.objects.create(name='عملیاتی')
        Expense.objects.create(category=category, title='هزینه تست', amount=100)
        Staff.objects.create(name='پرسنل تست')
        Service.objects.create(title='خدمت تست')
        VehicleType.objects.create(name='خودرو تست')
        customer = Customer.objects.create(name='مشتری تست')
        Cheque.objects.create(
            customer=customer,
            cheque_number='1',
            bank_name='بانک تست',
            amount=100,
            due_date=timezone.localdate(),
        )
        ChatMessage.objects.create(sender=self.user, text='پیام تست')

        endpoints = [
            '/api/customers/', '/api/expenses/', '/api/cheques/', '/api/staff/',
            '/api/services/', '/api/vehicle-types/', '/api/chat/',
        ]
        for endpoint in endpoints:
            with self.subTest(endpoint=endpoint):
                legacy = self.client.get(endpoint)
                self.assertEqual(legacy.status_code, 200, legacy.content)
                self.assertIsInstance(legacy.data, list)

                paged = self.client.get(f'{endpoint}?page_size=1')
                self.assert_paginated_envelope(paged, expected_count=1)
                self.assertEqual(len(paged.data['results']), 1)

    def test_customer_list_totals_are_bounded_by_prefetch_queries(self):
        for index in range(8):
            customer = Customer.objects.create(name=f'مشتری {index}')
            invoice = Invoice.objects.create(customer=customer, status='pending', total_amount=100)
            InvoicePayment.objects.create(invoice=invoice, amount=25)

        with CaptureQueriesContext(connection) as queries:
            response = self.client.get('/api/customers/')

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(response.data), 8)
        self.assertTrue(all(row['total_paid'] == 25 for row in response.data))
        # Permission lookup + customers/invoices/payments. This must not grow
        # with the number of customers or invoices.
        self.assertLessEqual(len(queries), 5)

    def test_customer_detail_totals_and_invoice_action_keep_response_shapes_and_queries_bounded(self):
        customer = Customer.objects.create(name='مشتری جزئیات')
        for index in range(4):
            invoice = Invoice.objects.create(customer=customer, status='paid', total_amount=100)
            InvoiceItem.objects.create(invoice=invoice, service_title_snapshot=f'خدمت {index}', main_price=100)
            InvoicePayment.objects.create(invoice=invoice, amount=50)

        with CaptureQueriesContext(connection) as detail_queries:
            detail = self.client.get(f'/api/customers/{customer.pk}/')
        self.assertEqual(detail.status_code, 200, detail.content)
        self.assertEqual(detail.data['total_invoices'], 4)
        self.assertEqual(detail.data['total_paid'], 400)
        self.assertIn('documents', detail.data)
        self.assertLessEqual(len(detail_queries), 7)

        with CaptureQueriesContext(connection) as invoice_queries:
            invoices = self.client.get(f'/api/customers/{customer.pk}/invoices/')
        self.assertEqual(invoices.status_code, 200, invoices.content)
        self.assertIsInstance(invoices.data, list)
        self.assertEqual(len(invoices.data), 4)
        self.assertTrue(all(row['paid_amount'] == 100 for row in invoices.data))
        self.assertLessEqual(len(invoice_queries), 10)

    def test_staff_performance_uses_one_decimal_aggregate_for_items(self):
        staff = Staff.objects.create(name='تکنسین تست', commission_rate=12.5)
        invoice = Invoice.objects.create(total_amount=500)
        InvoiceItem.objects.create(invoice=invoice, staff=staff, quantity=2, main_price=100, extra_price=25)
        InvoiceItem.objects.create(invoice=invoice, staff=staff, quantity=1, main_price=50, extra_price=10)

        with CaptureQueriesContext(connection) as queries:
            response = self.client.get(f'/api/staff/{staff.pk}/performance/')

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data, {
            'staff_id': staff.pk,
            'staff_name': 'تکنسین تست',
            'total_items': 2,
            'total_revenue': 310,
            'commission_rate': 12.5,
            'commission_earned': 38,
        })
        # Permission lookup + staff lookup + one aggregate query; there must
        # be no query/iteration per invoice item.
        self.assertLessEqual(len(queries), 4)

    def test_chat_pagination_preserves_recipient_filter_and_chronological_order(self):
        base = timezone.now()
        ChatMessage.objects.bulk_create([
            ChatMessage(sender=self.user, recipient=self.other_user, text='اول', created_at=base),
            ChatMessage(sender=self.other_user, recipient=self.user, text='دوم', created_at=base + timedelta(seconds=1)),
            ChatMessage(sender=self.user, recipient=self.other_user, text='سوم', created_at=base + timedelta(seconds=2)),
            ChatMessage(sender=self.other_user, recipient=None, text='عمومی', created_at=base + timedelta(seconds=3)),
        ])

        with CaptureQueriesContext(connection) as chat_queries:
            first = self.client.get(f'/api/chat/?recipient={self.other_user.pk}&page_size=2&page=1')
        second = self.client.get(f'/api/chat/?recipient={self.other_user.pk}&page_size=2&page=2')
        self.assert_paginated_envelope(first, expected_count=3)
        self.assert_paginated_envelope(second, expected_count=3)
        self.assertEqual([row['text'] for row in first.data['results']], ['اول', 'دوم'])
        self.assertEqual([row['text'] for row in second.data['results']], ['سوم'])
        self.assertLessEqual(len(chat_queries), 3)
