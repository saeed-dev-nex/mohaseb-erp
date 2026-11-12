"""Quick-create idempotency: offline-queue replays must not duplicate.

The client generates one UUID per quick-invoice draft; when a submission
is retried after a network failure (the response was lost, or the request
never arrived), the same key must return the original invoice.
"""
import uuid

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from api.models import Customer, IdempotentSubmission, Invoice


class QuickCreateIdempotencyTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='idem-operator', password='<redacted>', is_staff=True,
        )
        self.client.force_authenticate(self.user)

    def payload(self, **overrides):
        payload = {
            'customer_name': 'مشتری آفلاین',
            'customer_phone': '09120000000',
            'items': [{'service_title_snapshot': 'خدمت تست', 'quantity': 1, 'main_price': '1000'}],
        }
        payload.update(overrides)
        return payload

    def post(self, payload):
        return self.client.post('/api/invoices/quick_create/', payload, format='json')

    def test_retry_with_same_key_returns_original_invoice(self):
        key = str(uuid.uuid4())
        first = self.post(self.payload(idempotency_key=key))
        self.assertEqual(first.status_code, 201, first.data)
        second = self.post(self.payload(idempotency_key=key))
        self.assertEqual(second.status_code, 200, second.data)
        self.assertEqual(second.data['invoice']['id'], first.data['invoice']['id'])
        self.assertEqual(
            second.data['invoice']['invoice_number'],
            first.data['invoice']['invoice_number'],
        )
        self.assertEqual(set(second.data), {'invoice', 'customer', 'message'})
        self.assertEqual(Invoice.objects.count(), 1)
        self.assertEqual(Customer.objects.count(), 1)

    def test_different_keys_create_different_invoices(self):
        first = self.post(self.payload(idempotency_key=str(uuid.uuid4())))
        second = self.post(self.payload(idempotency_key=str(uuid.uuid4())))
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(second.status_code, 201, second.data)
        self.assertNotEqual(first.data['invoice']['id'], second.data['invoice']['id'])
        self.assertEqual(Invoice.objects.count(), 2)

    def test_missing_key_keeps_legacy_behaviour(self):
        first = self.post(self.payload())
        second = self.post(self.payload())
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(second.status_code, 201, second.data)
        self.assertEqual(Invoice.objects.count(), 2)
        self.assertFalse(IdempotentSubmission.objects.exists())

    def test_malformed_key_is_ignored(self):
        response = self.post(self.payload(idempotency_key='not-a-uuid'))
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(Invoice.objects.count(), 1)
        self.assertFalse(IdempotentSubmission.objects.exists())

    def test_keys_are_scoped_per_user(self):
        key = str(uuid.uuid4())
        mine = self.post(self.payload(idempotency_key=key))
        self.assertEqual(mine.status_code, 201, mine.data)
        other = User.objects.create_user(
            username='idem-other', password='<redacted>', is_staff=True,
        )
        self.client.force_authenticate(other)
        theirs = self.post(self.payload(idempotency_key=key))
        self.assertEqual(theirs.status_code, 201, theirs.data)
        self.assertNotEqual(theirs.data['invoice']['id'], mine.data['invoice']['id'])
        self.assertEqual(Invoice.objects.count(), 2)

    def test_failed_validation_does_not_burn_the_key(self):
        key = str(uuid.uuid4())
        bad = self.post(self.payload(idempotency_key=key, items=[]))
        self.assertEqual(bad.status_code, 400, bad.data)
        good = self.post(self.payload(idempotency_key=key))
        self.assertEqual(good.status_code, 201, good.data)
        self.assertEqual(Invoice.objects.count(), 1)
