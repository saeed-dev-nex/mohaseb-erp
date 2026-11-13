"""Quick-create must scope to the selected business (ERP regression).

The quick-invoice modal is the primary daily workflow, inherited from
the single-business base. It used to create the invoice — and its
auto-created customer — with no business at all: the invoice vanished
from the business's scoped lists and never reached the books.
"""

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from api.models import Business, Customer, Invoice, JournalEntry


class QuickCreateBusinessTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(
            username='quick-admin', password='<redacted>' + '-pass-12345',
        )
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            '/api/businesses/',
            {'name': 'فروشگاه سریع', 'template_key': 'retail', 'person_type': 'legal'},
            format='json',
        )
        assert response.status_code == 201, response.content
        self.business = Business.objects.get(name='فروشگاه سریع')
        self.headers = {'HTTP_X_BUSINESS_ID': str(self.business.id)}

    def _quick(self, **overrides):
        payload = {
            'customer_name': 'مشتری سریع',
            'customer_phone': '09123334455',
            'items': [
                {'service_title_snapshot': 'خدمت سریع', 'quantity': 1, 'main_price': 55000},
            ],
        }
        payload.update(overrides)
        return self.client.post(
            '/api/invoices/quick_create/', payload, format='json', **self.headers,
        )

    def test_quick_invoice_belongs_to_business_and_posts_journal(self):
        created = self._quick()
        self.assertEqual(created.status_code, 201, created.content)
        invoice = Invoice.objects.get(id=created.data['invoice']['id'])
        self.assertEqual(invoice.business_id, self.business.id)
        self.assertTrue(invoice.inventory_posted)
        self.assertIsNotNone(invoice.sales_journal_id)
        entry = JournalEntry.objects.get(id=invoice.sales_journal_id)
        self.assertEqual(entry.total_debit, 55000)
        # The auto-created customer belongs to the business too.
        customer = Customer.objects.get(id=created.data['customer']['id'])
        self.assertEqual(customer.business_id, self.business.id)
        # And the invoice is visible in the business-scoped list.
        listing = self.client.get('/api/invoices/', **self.headers)
        rows = listing.data if isinstance(listing.data, list) else listing.data['results']
        self.assertIn(invoice.id, [row['id'] for row in rows])

    def test_quick_invoice_does_not_adopt_another_business_customer(self):
        other = self.client.post(
            '/api/businesses/',
            {'name': 'کسب‌وکار دیگر', 'template_key': 'general', 'person_type': 'legal'},
            format='json',
        )
        assert other.status_code == 201, other.content
        other_business = Business.objects.get(name='کسب‌وکار دیگر')
        foreign = Customer.objects.create(
            business=other_business, name='مشتری بیگانه', phone='09123334455',
        )
        created = self._quick()
        self.assertEqual(created.status_code, 201, created.content)
        self.assertNotEqual(created.data['customer']['id'], foreign.id)
        own = Customer.objects.get(id=created.data['customer']['id'])
        self.assertEqual(own.business_id, self.business.id)
