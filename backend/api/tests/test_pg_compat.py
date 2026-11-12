"""PostgreSQL compatibility regressions.

These tests pin two behaviours that SQLite hides but PostgreSQL exposes:
invoice-number seeding must not trust primary keys of INV-numbered rows
(PG sequences run ahead of the data), and a backup restore — which
reinserts rows with their source pks — must leave table sequences ahead
of the restored pks so the next insert cannot collide.
"""
from django.contrib.auth.models import User
from django.test import TestCase

from api.backup_utils import build_backup, restore_backup
from api.models import Customer, Invoice, InvoiceNumberCounter


class HighestExistingNumberTests(TestCase):
    def test_pks_of_inv_numbered_rows_are_ignored(self):
        Invoice.objects.create(id=500, invoice_number='INV-00002', total_amount=100)
        Invoice.objects.create(id=501, invoice_number='INV-00001', total_amount=100)
        self.assertEqual(InvoiceNumberCounter.highest_existing_number(), 2)

    def test_non_inv_numbers_still_fall_back_to_pk(self):
        Invoice.objects.create(id=40, invoice_number='CUSTOM-7', total_amount=100)
        self.assertEqual(InvoiceNumberCounter.highest_existing_number(), 40)


class RestoreSequenceTests(TestCase):
    def test_create_after_restore_with_preserved_high_pks(self):
        user = User.objects.create_user(username='seq-user', password='<redacted>')
        customer = Customer.objects.create(id=700, name='مشتری سکانس', phone='09120000000')
        Invoice.objects.create(
            id=900, customer=customer, invoice_number='INV-00001', total_amount=100,
        )
        payload = build_backup()
        Invoice.objects.all().delete()
        Customer.objects.all().delete()

        restore_backup(payload, fallback_user_id=user.id)

        # The next inserts must not reuse a restored pk (on PostgreSQL the
        # restore resets the sequences; SQLite allocates max+1 natively).
        new_customer = Customer.objects.create(name='مشتری تازه')
        new_invoice = Invoice.objects.create(
            customer=new_customer, total_amount=200, status='pending',
        )
        self.assertEqual(new_invoice.invoice_number, 'INV-00002')
        self.assertNotIn(new_customer.pk, {700})
        self.assertNotIn(new_invoice.pk, {900})
