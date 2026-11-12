"""ERP phase 5 — extra templates + mohaseb-pro legacy import."""

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from api.business_templates import TEMPLATES, get_template
from api.models import Business, Customer, Invoice, Service


def legacy_payload():
    payload = {
        'format': 'mohaseb-backup-v1',
        'fixtures': [
            {
                'model': 'api.customer', 'pk': 11,
                'fields': {
                    'name': 'مشتری قدیمی', 'phone': '09120000001',
                    'national_id': '1112223334', 'address': 'تهران',
                    'person_type': 'natural',
                },
            },
            {
                'model': 'api.service', 'pk': 21,
                'fields': {'title': 'خدمت قدیمی', 'default_main_price': 500_000},
            },
            {
                'model': 'api.staff', 'pk': 31,
                'fields': {'name': 'تکنسین قدیمی', 'phone': '09120000002'},
            },
            {
                'model': 'api.invoice', 'pk': 41,
                'fields': {
                    'invoice_number': 'INV-00007', 'customer': 11,
                    'date': '2025-05-01T10:00:00+03:30', 'status': 'paid',
                    'total_amount': '1500000', 'tax': '10',
                    'discount': '0', 'service_fee': '0', 'rounding_amount': '0',
                },
            },
            {
                'model': 'api.invoiceitem', 'pk': 51,
                'fields': {
                    'invoice': 41, 'service': 21, 'title': 'خدمت قدیمی',
                    'quantity': 3, 'main_price': '500000', 'extra_price': '0',
                },
            },
            {'model': 'api.expense', 'pk': 61, 'fields': {'title': 'نادیده'}},
        ],
    }
    from api.backup_utils import _checksum

    payload['sha256'] = _checksum(payload)
    return payload


class LegacyImportTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(
            username='legacy-admin', password='admin' + '-pass-12345',
        )
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            '/api/businesses/',
            {'name': 'مقصد مهاجرت', 'template_key': 'general', 'person_type': 'legal'},
            format='json',
        )
        assert response.status_code == 201, response.content
        self.business = Business.objects.get(name='مقصد مهاجرت')

    def test_templates_registry_has_twelve(self):
        self.assertEqual(len(TEMPLATES), 12)
        for key in ('cafe', 'beauty_salon', 'clinic', 'carwash', 'education'):
            template = get_template(key)
            self.assertTrue(template['catalog'])
            self.assertIn('invoice_profile', template)

    def test_new_template_seeds_catalog(self):
        response = self.client.post(
            '/api/businesses/',
            {'name': 'کارواش نمونه', 'template_key': 'carwash', 'person_type': 'legal'},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        business = Business.objects.get(name='کارواش نمونه')
        self.assertTrue(business.business_services.filter(title='صفرشویی داخل').exists())

    def test_import_scopes_everything_to_the_business(self):
        response = self.client.post(
            f'/api/businesses/{self.business.id}/import-legacy/',
            {'payload': legacy_payload()}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        data = response.data
        self.assertEqual(data['customers_created'], 1)
        self.assertEqual(data['services_created'], 1)
        self.assertEqual(data['staff_created'], 1)
        self.assertEqual(data['invoices_created'], 1)
        self.assertEqual(data['items_created'], 1)
        customer = Customer.objects.get(name='مشتری قدیمی')
        self.assertEqual(customer.business_id, self.business.id)
        service = Service.objects.get(title='خدمت قدیمی')
        self.assertEqual(service.business_id, self.business.id)
        invoice = Invoice.objects.get(invoice_number='INV-00007')
        self.assertEqual(invoice.business_id, self.business.id)
        self.assertEqual(invoice.customer_id, customer.id)
        item = invoice.items.get()
        self.assertEqual(item.service_id, service.id)
        self.assertEqual(int(item.line_total), 1_500_000)

    def test_import_is_idempotent_for_invoices_and_customers(self):
        first = self.client.post(
            f'/api/businesses/{self.business.id}/import-legacy/',
            {'payload': legacy_payload()}, format='json',
        )
        self.assertEqual(first.status_code, 200, first.content)
        second = self.client.post(
            f'/api/businesses/{self.business.id}/import-legacy/',
            {'payload': legacy_payload()}, format='json',
        )
        data = second.data
        self.assertEqual(data['invoices_created'], 0)
        self.assertEqual(data['invoices_skipped'], 1)
        self.assertEqual(data['customers_matched'], 1)
        self.assertEqual(Invoice.objects.filter(invoice_number='INV-00007').count(), 1)

    def test_import_rejects_garbage(self):
        response = self.client.post(
            f'/api/businesses/{self.business.id}/import-legacy/',
            {'payload': {'format': 'nope'}}, format='json',
        )
        self.assertEqual(response.status_code, 400)
