"""Real-time edit-request alerts: payload shape, delivery filter, hooks."""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from ..alerts import edit_request_payload
from ..consumers import alert_should_deliver
from ..models import Customer, Invoice, InvoiceEditRequest

User = get_user_model()


class FakeLayer:
    def __init__(self):
        self.sent = []

    async def group_send(self, group, message):
        self.sent.append((group, message))


class AlertFilterTests(SimpleTestCase):
    def test_created_goes_to_managers_only(self):
        payload = {'kind': 'edit_request_created', 'requested_by_id': 7}
        self.assertTrue(alert_should_deliver(payload, user_id=1, is_manager=True))
        self.assertFalse(alert_should_deliver(payload, user_id=7, is_manager=False))

    def test_reviewed_goes_to_requester_and_managers(self):
        payload = {'kind': 'edit_request_reviewed', 'requested_by_id': 7}
        self.assertTrue(alert_should_deliver(payload, user_id=7, is_manager=False))
        self.assertTrue(alert_should_deliver(payload, user_id=1, is_manager=True))
        self.assertFalse(alert_should_deliver(payload, user_id=9, is_manager=False))

    def test_unknown_kind_never_delivers(self):
        self.assertFalse(alert_should_deliver({'kind': 'other'}, user_id=1, is_manager=True))


class EditRequestAlertHookTests(TestCase):
    def setUp(self):
        self.operator = User.objects.create_user(username='op-alerts', password='op' + '-pass-12345')
        self.manager = User.objects.create_user(username='mgr-alerts', password='mgr' + '-pass-12345', is_staff=True)
        customer = Customer.objects.create(name='مشتری هشدار')
        self.invoice = Invoice.objects.create(
            customer=customer, status='paid', total_amount=100000,
            invoice_number='INV-90001', created_by=self.manager,
        )
        self.layer = FakeLayer()
        layer_patch = patch('api.alerts.get_channel_layer', return_value=self.layer)
        layer_patch.start()
        self.addCleanup(layer_patch.stop)
        self.client = APIClient()

    def test_create_and_review_broadcast_alerts(self):
        self.client.force_authenticate(self.operator)
        response = self.client.post(f'/api/invoices/{self.invoice.id}/request-edit/', {}, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(len(self.layer.sent), 1)
        group, message = self.layer.sent[0]
        self.assertEqual(group, 'alerts_room')
        payload = message['payload']
        self.assertEqual(payload['kind'], 'edit_request_created')
        self.assertEqual(payload['invoice_number'], 'INV-90001')
        self.assertEqual(payload['requested_by_id'], self.operator.id)

        request_id = response.data['id']
        self.client.force_authenticate(self.manager)
        response = self.client.post(
            f'/api/invoices/{self.invoice.id}/review-edit-request/',
            {'request_id': request_id, 'decision': 'approve'},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(self.layer.sent), 2)
        payload = self.layer.sent[1][1]['payload']
        self.assertEqual(payload['kind'], 'edit_request_reviewed')
        self.assertEqual(payload['status'], 'approved')
        self.assertEqual(payload['reviewed_by_id'], self.manager.id)

    def test_payload_shape(self):
        edit_request = InvoiceEditRequest.objects.create(
            invoice=self.invoice, requested_by=self.operator,
        )
        payload = edit_request_payload('edit_request_created', edit_request)
        self.assertEqual(payload['request_id'], edit_request.id)
        self.assertEqual(payload['invoice_id'], self.invoice.id)
        self.assertEqual(payload['requested_by'], 'op-alerts')
        self.assertEqual(payload['status'], 'pending')
