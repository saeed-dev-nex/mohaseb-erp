"""Model-level tests for the financial core: amounts and invoice numbers.

These cover the calculations every report, receipt and balance depends on,
plus the atomic invoice-number counter (migration 0022).
"""

from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase

from api.models import Customer, Invoice, InvoiceItem, InvoicePayment, Service


def make_invoice(**overrides):
    defaults = {'total_amount': Decimal('100000'), 'tax': Decimal('0'), 'discount': Decimal('0'),
                'commission_total': Decimal('0'), 'status': 'pending'}
    defaults.update(overrides)
    return Invoice.objects.create(**defaults)


class InvoiceAmountTests(TestCase):
    def test_final_amount_without_tax_discount_or_commission(self):
        invoice = make_invoice()
        self.assertEqual(invoice.final_amount, Decimal('100000'))

    def test_final_amount_applies_tax_discount_and_commission(self):
        # 100000 + 10% tax - 5000 discount + 7000 commission = 112000
        invoice = make_invoice(tax=Decimal('10'), discount=Decimal('5000'),
                                commission_total=Decimal('7000'))
        self.assertEqual(invoice.final_amount, Decimal('112000'))

    def test_final_amount_tax_is_percentage_of_total(self):
        invoice = make_invoice(total_amount=Decimal('250000'), tax=Decimal('9'))
        self.assertEqual(invoice.final_amount, Decimal('272500'))

    def test_final_amount_with_int_fields_and_decimal_commission(self):
        # Regression: a freshly-built instance can still hold plain ints
        # (e.g. serializer defaults before a DB round-trip); int/int
        # division used to produce a float that crashed against the
        # Decimal commission when creating an invoice via the API.
        invoice = Invoice(total_amount=450000, tax=0, discount=0,
                          commission_total=Decimal('50000'))
        self.assertEqual(invoice.final_amount, Decimal('500000'))


class InvoiceItemTests(TestCase):
    def setUp(self):
        self.service = Service.objects.create(title='خلافی', default_main_price=1000)
        self.invoice = make_invoice()

    def test_line_total_multiplies_prices_by_quantity(self):
        item = InvoiceItem.objects.create(
            invoice=self.invoice, service=self.service, quantity=3,
            main_price=Decimal('10000'), extra_price=Decimal('2000'),
            commission=Decimal('500'),
        )
        self.assertEqual(item.line_total, Decimal('36000'))

    def test_line_commission_multiplies_by_quantity(self):
        item = InvoiceItem.objects.create(
            invoice=self.invoice, service=self.service, quantity=4,
            main_price=Decimal('1000'), commission=Decimal('250'),
        )
        self.assertEqual(item.line_commission, Decimal('1000'))

    def test_service_title_snapshot_is_filled_from_service(self):
        item = InvoiceItem.objects.create(invoice=self.invoice, service=self.service)
        self.assertEqual(item.service_title_snapshot, 'خلافی')
        self.assertEqual(item.service_title, 'خلافی')


class InvoiceNumberingTests(TestCase):
    def test_first_invoice_gets_number_one(self):
        invoice = make_invoice()
        self.assertEqual(invoice.invoice_number, 'INV-00001')

    def test_numbers_are_sequential(self):
        first = make_invoice()
        second = make_invoice()
        self.assertEqual(first.invoice_number, 'INV-00001')
        self.assertEqual(second.invoice_number, 'INV-00002')

    def test_number_is_not_reused_after_deleting_latest_invoice(self):
        make_invoice()
        second = make_invoice()
        second.delete()
        third = make_invoice()
        self.assertEqual(third.invoice_number, 'INV-00003')

    def test_numbering_continues_after_legacy_numbers(self):
        Invoice.objects.create(invoice_number='INV-00041', total_amount=1000)
        invoice = make_invoice()
        self.assertEqual(invoice.invoice_number, 'INV-00042')

    def test_explicit_invoice_number_is_kept(self):
        invoice = Invoice.objects.create(invoice_number='CUSTOM-7', total_amount=1000)
        self.assertEqual(invoice.invoice_number, 'CUSTOM-7')

    def test_many_invoices_get_unique_numbers(self):
        numbers = {make_invoice().invoice_number for _ in range(10)}
        self.assertEqual(len(numbers), 10)


class CustomerTotalsTests(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(name='مشتری تست')

    def test_total_paid_uses_final_amount_for_paid_invoice_without_payments(self):
        make_invoice(customer=self.customer, total_amount=Decimal('50000'), status='paid')
        self.assertEqual(self.customer.total_paid, Decimal('50000'))

    def test_total_paid_sums_recorded_payments(self):
        invoice = make_invoice(customer=self.customer, total_amount=Decimal('50000'))
        InvoicePayment.objects.create(invoice=invoice, amount=Decimal('20000'))
        InvoicePayment.objects.create(invoice=invoice, amount=Decimal('15000'))
        self.assertEqual(self.customer.total_paid, Decimal('35000'))

    def test_total_paid_is_zero_without_invoices(self):
        self.assertEqual(self.customer.total_paid, 0)

    def test_total_paid_counts_full_final_for_settled_invoice_with_partial_records(self):
        invoice = make_invoice(customer=self.customer, total_amount=Decimal('50000'), status='paid')
        InvoicePayment.objects.create(invoice=invoice, amount=Decimal('20000'))
        self.assertEqual(self.customer.total_paid, Decimal('50000'))


class InvoiceSerializerPaymentTests(TestCase):
    """paid_amount / remaining_amount exposed by the API.

    The frontend shows the remaining balance next to the invoice total
    whenever a customer has paid only part of an invoice, so these computed
    fields are the contract that display depends on.
    """

    def serialize(self, invoice):
        from api.serializers import InvoiceSerializer
        return InvoiceSerializer(invoice).data

    def test_partial_payment_reports_paid_and_remaining(self):
        invoice = make_invoice(total_amount=Decimal('50000'))
        InvoicePayment.objects.create(invoice=invoice, amount=Decimal('20000'))
        data = self.serialize(invoice)
        self.assertEqual(data['paid_amount'], 20000)
        self.assertEqual(data['remaining_amount'], 30000)

    def test_multiple_partial_payments_sum_up(self):
        invoice = make_invoice(total_amount=Decimal('50000'))
        InvoicePayment.objects.create(invoice=invoice, amount=Decimal('20000'))
        InvoicePayment.objects.create(invoice=invoice, amount=Decimal('15000'))
        data = self.serialize(invoice)
        self.assertEqual(data['paid_amount'], 35000)
        self.assertEqual(data['remaining_amount'], 15000)

    def test_full_payment_via_records_leaves_no_remaining(self):
        invoice = make_invoice(total_amount=Decimal('50000'))
        InvoicePayment.objects.create(invoice=invoice, amount=Decimal('50000'))
        data = self.serialize(invoice)
        self.assertEqual(data['paid_amount'], 50000)
        self.assertEqual(data['remaining_amount'], 0)

    def test_paid_invoice_without_payment_records_counts_as_fully_paid(self):
        invoice = make_invoice(total_amount=Decimal('50000'), status='paid')
        data = self.serialize(invoice)
        self.assertEqual(data['paid_amount'], 50000)
        self.assertEqual(data['remaining_amount'], 0)

    def test_unpaid_invoice_has_full_remaining(self):
        invoice = make_invoice(total_amount=Decimal('50000'))
        data = self.serialize(invoice)
        self.assertEqual(data['paid_amount'], 0)
        self.assertEqual(data['remaining_amount'], 50000)

    def test_settled_after_partial_payments_reports_full_paid_amount(self):
        # Regression: an invoice settled after staged payments must show
        # the full final amount as paid, not just the recorded sum.
        invoice = make_invoice(total_amount=Decimal('50000'), status='paid')
        InvoicePayment.objects.create(invoice=invoice, amount=Decimal('20000'))
        data = self.serialize(invoice)
        self.assertEqual(data['paid_amount'], 50000)
        self.assertEqual(data['remaining_amount'], 0)

    def test_status_display_paid_wins_over_commission_label(self):
        # Regression: a fully-paid invoice reads «پرداخت شده» even when
        # its commission was settled earlier.
        invoice = make_invoice(status='paid', commission_paid=True)
        self.assertEqual(self.serialize(invoice)['status_display'], 'پرداخت شده')

    def test_status_display_commission_label_while_unpaid(self):
        invoice = make_invoice(status='pending', commission_paid=True)
        self.assertEqual(self.serialize(invoice)['status_display'], 'کارمزد پرداخت شده')

    def test_status_display_plain_pending(self):
        invoice = make_invoice(status='pending')
        self.assertEqual(self.serialize(invoice)['status_display'], 'پرداخت نشده')
