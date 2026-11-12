"""Alerts WebSocket end-to-end (Channels communicator, in-memory layer).

Regression guard: SimpleJWT hands the consumer a *string* user_id
claim while alert payloads carry the ORM int — the consumer must
normalize, or the requester silently never receives review outcomes.
"""

import asyncio

from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from django.test import TransactionTestCase
from rest_framework_simplejwt.tokens import AccessToken

from ..alerts import notify_edit_request_created, notify_edit_request_reviewed
from ..models import Customer, Invoice, InvoiceEditRequest
from ..routing import websocket_urlpatterns

User = get_user_model()


class AlertsWebSocketTests(TransactionTestCase):
    def setUp(self):
        self.operator = User.objects.create_user(username='ws-req', password='op' + '-pass-12345')
        self.manager = User.objects.create_user(username='ws-mgr', password='mgr' + '-pass-12345', is_staff=True)
        customer = Customer.objects.create(name='مشتری وب‌سوکت')
        self.invoice = Invoice.objects.create(
            customer=customer, status='paid', total_amount=50000,
            invoice_number='INV-70010',
        )
        self.edit_request = InvoiceEditRequest.objects.create(
            invoice=self.invoice, requested_by=self.operator,
        )

    def _connect(self, user):
        token = str(AccessToken.for_user(user))
        return WebsocketCommunicator(
            URLRouter(websocket_urlpatterns),
            '/ws/alerts/',
            subprotocols=['mohaseb-alerts', token],
        )

    def test_created_reaches_managers_not_the_requester(self):
        async def run():
            manager_ws = self._connect(self.manager)
            operator_ws = self._connect(self.operator)
            self.assertTrue((await manager_ws.connect())[0])
            self.assertTrue((await operator_ws.connect())[0])
            await manager_ws.receive_json_from(timeout=2)
            await operator_ws.receive_json_from(timeout=2)

            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, notify_edit_request_created, self.edit_request)

            message = await manager_ws.receive_json_from(timeout=3)
            self.assertEqual(message['type'], 'alert')
            self.assertEqual(message['alert']['kind'], 'edit_request_created')
            self.assertTrue(await operator_ws.receive_nothing(timeout=1))
            await manager_ws.disconnect()
            await operator_ws.disconnect()

        asyncio.new_event_loop().run_until_complete(run())

    def test_reviewed_reaches_the_requester(self):
        async def run():
            operator_ws = self._connect(self.operator)
            self.assertTrue((await operator_ws.connect())[0])
            await operator_ws.receive_json_from(timeout=2)

            self.edit_request.status = 'approved'
            self.edit_request.reviewed_by = self.manager
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, notify_edit_request_reviewed, self.edit_request)

            message = await operator_ws.receive_json_from(timeout=3)
            self.assertEqual(message['type'], 'alert')
            self.assertEqual(message['alert']['kind'], 'edit_request_reviewed')
            self.assertEqual(message['alert']['status'], 'approved')
            self.assertEqual(message['alert']['requested_by_id'], self.operator.id)
            await operator_ws.disconnect()

        asyncio.new_event_loop().run_until_complete(run())
