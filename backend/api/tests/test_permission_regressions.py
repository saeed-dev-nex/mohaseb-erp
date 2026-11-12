"""Security regression cases; all records live in Django's isolated test DB."""

from datetime import timedelta
from unittest.mock import patch

from channels.db import database_sync_to_async
from channels.layers import get_channel_layer
from channels.testing import WebsocketCommunicator
from django.contrib.auth.models import User
from django.test import TransactionTestCase
from django.utils import timezone
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import AccessToken

from api.consumers import ChatConsumer
from api.models import AuditLog, BusinessProfile, Cheque, Customer, Invoice, SocialNetwork, UserModuleAccess


class PermissionRegressionTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_superuser(username='permission-admin', password='synthetic-pass')
        cls.manager = User.objects.create_user(username='permission-manager', password='synthetic-pass', is_staff=True)
        cls.operator = User.objects.create_user(username='permission-operator', password='synthetic-pass')

    def test_manager_cannot_use_any_user_management_endpoint(self):
        self.client.force_authenticate(self.manager)
        target = f'/api/users/{self.manager.pk}/'
        for method, url, data in [
            ('get', '/api/users/', None),
            ('get', target, None),
            ('post', '/api/users/', {'username': 'unwanted-user'}),
            ('patch', target, {'is_superuser': True}),
            ('delete', f'/api/users/{self.operator.pk}/', None),
            ('post', '/api/users/set_role/', {'user_id': self.manager.pk, 'role': 'admin'}),
            ('get', target + 'module_access/', None),
            ('put', target + 'module_access/', {'chat': False}),
        ]:
            with self.subTest(method=method, url=url):
                response = getattr(self.client, method)(url, data, format='json')
                self.assertEqual(response.status_code, 403)
        self.manager.refresh_from_db()
        self.assertFalse(self.manager.is_superuser)

    def test_me_remains_available_to_operator(self):
        self.client.force_authenticate(self.operator)
        self.assertEqual(self.client.get('/api/users/me/').status_code, 200)

    def test_invalid_role_is_rejected_everywhere(self):
        self.client.force_authenticate(self.admin)
        for role in ['owner', '', None, ['admin']]:
            for method, url, data in [
                ('post', '/api/users/set_role/', {'user_id': self.manager.pk, 'role': role}),
                ('patch', f'/api/users/{self.manager.pk}/', {'role': role}),
                ('post', '/api/users/', {'username': 'bad-role', 'role': role}),
            ]:
                with self.subTest(role=role, url=url):
                    self.assertEqual(getattr(self.client, method)(url, data, format='json').status_code, 400)

    def test_role_is_applied_to_create_and_update(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post('/api/users/', {'username': 'created-manager', 'role': 'manager'}, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.data['is_staff'])
        response = self.client.patch(f'/api/users/{self.manager.pk}/', {'role': 'admin'}, format='json')
        self.assertEqual(response.status_code, 200)
        self.manager.refresh_from_db()
        self.assertTrue(self.manager.is_superuser)

    def test_admin_cannot_lock_out_own_account_even_with_another_admin(self):
        User.objects.create_superuser(username='second-admin', password='synthetic-pass')
        self.client.force_authenticate(self.admin)
        for method, url, data in [
            ('delete', f'/api/users/{self.admin.pk}/', None),
            ('patch', f'/api/users/{self.admin.pk}/', {'is_active': False}),
            ('patch', f'/api/users/{self.admin.pk}/', {'is_superuser': False}),
            ('patch', f'/api/users/{self.admin.pk}/', {'role': 'operator'}),
            ('post', '/api/users/set_role/', {'user_id': self.admin.pk, 'role': 'manager'}),
        ]:
            with self.subTest(method=method, data=data):
                self.assertEqual(getattr(self.client, method)(url, data, format='json').status_code, 400)
        self.admin.refresh_from_db()
        self.assertTrue(self.admin.is_active)
        self.assertTrue(self.admin.is_superuser)

    def test_last_active_admin_is_protected_even_if_request_actor_is_inactive(self):
        # force_authenticate exercises the invariant independently of JWT's
        # separate rejection of inactive account credentials.
        inactive_admin = User.objects.create_superuser(username='inactive-admin', password='synthetic-pass', is_active=False)
        self.client.force_authenticate(inactive_admin)
        for method, url, data in [
            ('delete', f'/api/users/{self.admin.pk}/', None),
            ('patch', f'/api/users/{self.admin.pk}/', {'is_active': False}),
            ('patch', f'/api/users/{self.admin.pk}/', {'is_superuser': False}),
            ('post', '/api/users/set_role/', {'user_id': self.admin.pk, 'role': 'manager'}),
        ]:
            with self.subTest(method=method, data=data):
                self.assertIn(getattr(self.client, method)(url, data, format='json').status_code, (400, 403))
        self.admin.refresh_from_db()
        self.assertTrue(self.admin.is_active and self.admin.is_superuser)

    def test_admin_can_demote_or_delete_another_admin_while_one_remains(self):
        other = User.objects.create_superuser(username='other-admin', password='synthetic-pass')
        self.client.force_authenticate(self.admin)
        response = self.client.post('/api/users/set_role/', {'user_id': other.pk, 'role': 'manager'}, format='json')
        self.assertEqual(response.status_code, 200)
        other.refresh_from_db()
        self.assertFalse(other.is_superuser)
        self.assertEqual(self.client.delete(f'/api/users/{other.pk}/').status_code, 204)

    def test_last_active_admin_guard_handles_actor_revoked_after_authentication(self):
        stale_actor = User.objects.create_superuser(username='stale-admin', password='synthetic-pass')
        # Model an already-authenticated request whose actor is then revoked
        # by another transaction. The database now has only one active admin.
        User.objects.filter(pk=stale_actor.pk).update(is_active=False)
        self.client.force_authenticate(stale_actor)
        for method, url, data in [
            ('delete', f'/api/users/{self.admin.pk}/', None),
            ('patch', f'/api/users/{self.admin.pk}/', {'is_active': False}),
            ('patch', f'/api/users/{self.admin.pk}/', {'is_superuser': False}),
            ('post', '/api/users/set_role/', {'user_id': self.admin.pk, 'role': 'operator'}),
        ]:
            with self.subTest(method=method, data=data):
                self.assertEqual(getattr(self.client, method)(url, data, format='json').status_code, 400)
        self.admin.refresh_from_db()
        self.assertTrue(self.admin.is_active and self.admin.is_superuser)

    def test_settings_writes_require_manager_and_settings_module(self):
        network = SocialNetwork.objects.create(profile=BusinessProfile.load(), name='Synthetic', url='https://example.test/')
        writes = [
            ('patch', '/api/profile/update_profile/', {'name': 'Changed'}, 'multipart'),
            ('post', '/api/social-networks/', {'name': 'Changed', 'url': 'https://example.test/'}, 'multipart'),
            ('patch', f'/api/social-networks/{network.pk}/', {'name': 'Changed'}, 'multipart'),
            ('delete', f'/api/social-networks/{network.pk}/', None, 'multipart'),
            ('patch', '/api/invoice-settings/update_config/', {'show_tax_field': False}, 'json'),
            ('patch', '/api/welcome-settings/config/', {'enabled': True}, 'json'),
            ('post', '/api/welcome-settings/personal/', {'user_id': self.operator.pk, 'message': 'Synthetic'}, 'json'),
        ]
        for user in [self.operator, self.manager]:
            if user == self.manager:
                UserModuleAccess.objects.create(user=user, settings=False)
            self.client.force_authenticate(user)
            for method, url, data, fmt in writes:
                with self.subTest(user=user.username, method=method, url=url):
                    response = getattr(self.client, method)(url, data, format=fmt)
                    self.assertEqual(response.status_code, 403)

    def test_manager_can_write_branding_but_cannot_change_storage_path(self):
        self.client.force_authenticate(self.manager)
        response = self.client.patch('/api/profile/update_profile/', {'name': 'Synthetic branding'}, format='multipart')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['name'], 'Synthetic branding')
        self.assertNotIn('customer_documents_path', response.data)
        response = self.client.patch('/api/profile/update_profile/', {'customer_documents_path': 'C:/synthetic-docs'}, format='multipart')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(BusinessProfile.load().customer_documents_path, '')

    def test_storage_path_is_only_visible_and_writable_to_superuser(self):
        profile = BusinessProfile.load()
        profile.customer_documents_path = 'C:/synthetic-docs'
        profile.save()
        for user in [self.operator, self.manager]:
            self.client.force_authenticate(user)
            response = self.client.get('/api/profile/')
            self.assertEqual(response.status_code, 200)
            self.assertNotIn('customer_documents_path', response.data)
        self.client.force_authenticate(self.admin)
        response = self.client.patch('/api/profile/update_profile/', {'customer_documents_path': 'C:/synthetic-new'}, format='multipart')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['customer_documents_path'], 'C:/synthetic-new')

    def test_settings_reads_and_personal_welcome_still_work_for_operator(self):
        self.client.force_authenticate(self.operator)
        for method, url in [('get', '/api/profile/'), ('get', '/api/social-networks/'),
                            ('get', '/api/invoice-settings/'), ('post', '/api/welcome-settings/today/')]:
            with self.subTest(url=url):
                self.assertEqual(getattr(self.client, method)(url).status_code, 200)

    def test_manager_with_settings_can_update_invoice_welcome_and_social_settings(self):
        self.client.force_authenticate(self.manager)
        for method, url, data, fmt, expected in [
            ('patch', '/api/invoice-settings/update_config/', {'show_tax_field': False}, 'json', 200),
            ('patch', '/api/welcome-settings/config/', {'enabled': True, 'global_message': 'Synthetic'}, 'json', 200),
            ('post', '/api/welcome-settings/personal/', {'user_id': self.operator.pk, 'message': 'Synthetic personal'}, 'json', 200),
            ('post', '/api/social-networks/', {'name': 'Synthetic', 'url': 'https://example.test/'}, 'multipart', 201),
        ]:
            with self.subTest(url=url):
                self.assertEqual(getattr(self.client, method)(url, data, format=fmt).status_code, expected)

    def test_reports_disabled_keeps_landing_but_omits_financial_analytics(self):
        UserModuleAccess.objects.create(user=self.operator, reports=False)
        Customer.objects.create(name='Synthetic dashboard customer')
        self.client.force_authenticate(self.operator)
        response = self.client.get('/api/dashboard/stats/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['total_customers'], 1)
        for key in ['total_revenue', 'total_commission', 'total_expenses', 'net_profit',
                    'monthly_revenue', 'top_customers', 'top_services', 'overdue_amount',
                    'overdue_items', 'pending_incoming_cheques_amount']:
            self.assertNotIn(key, response.data)
        response = self.client.get('/api/dashboard/reminders/')
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('overdue_invoices', response.data)
        self.assertNotIn('bounced_cheques', response.data)
        self.assertEqual(response.data['totals'], {})

    def test_dashboard_and_reminders_respect_resource_modules(self):
        UserModuleAccess.objects.create(user=self.operator, invoices=False, cheques=False, customers=False, expenses=False)
        self.client.force_authenticate(self.operator)
        stats = self.client.get('/api/dashboard/stats/').data
        for key in ['total_customers', 'total_invoices', 'recent_invoices', 'total_revenue',
                    'upcoming_cheques', 'total_expenses', 'net_profit', 'monthly_revenue']:
            self.assertNotIn(key, stats)
        reminders = self.client.get('/api/dashboard/reminders/').data
        self.assertEqual(reminders['totals'], {})
        self.assertNotIn('overdue_invoices', reminders)
        self.assertNotIn('cheques_due', reminders)

    def test_reminders_retain_allowed_sections_and_remove_denied_totals(self):
        today = timezone.localdate()
        invoice = Invoice.objects.create(total_amount=12000, due_date=today - timedelta(days=1))
        Cheque.objects.create(cheque_number='synthetic-cheque', bank_name='Synthetic', amount=8000,
                              due_date=today + timedelta(days=1))
        access = UserModuleAccess.objects.create(user=self.operator, cheques=False)
        self.client.force_authenticate(self.operator)
        response = self.client.get('/api/dashboard/reminders/')
        self.assertEqual(response.data['overdue_invoices'][0]['id'], invoice.pk)
        self.assertEqual(response.data['totals']['overdue_invoices_amount'], 12000)
        self.assertNotIn('cheques_due', response.data)
        self.assertNotIn('cheques_due_amount', response.data['totals'])
        access.cheques = True
        access.invoices = False
        access.save()
        self.operator.refresh_from_db()
        response = self.client.get('/api/dashboard/reminders/')
        self.assertEqual(response.data['totals']['cheques_due_amount'], 8000)
        self.assertNotIn('overdue_invoices', response.data)
        self.assertNotIn('overdue_invoices_amount', response.data['totals'])

    def test_audit_requires_manager_reports_and_matching_resource_module(self):
        event = AuditLog.objects.create(user=self.admin, object_type='invoice', object_id='1', action='create')
        self.client.force_authenticate(self.operator)
        self.assertEqual(self.client.get('/api/audit/?object_type=invoice&object_id=1').status_code, 403)
        access = UserModuleAccess.objects.create(user=self.manager, reports=False)
        self.client.force_authenticate(self.manager)
        self.assertEqual(self.client.get('/api/audit/').status_code, 403)
        access.reports = True
        access.invoices = False
        access.save()
        self.manager.refresh_from_db()
        response = self.client.get('/api/audit/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, [])
        self.assertEqual(self.client.get(f'/api/audit/{event.pk}/').status_code, 404)

    def test_manager_can_read_authorized_audit_history_and_detail(self):
        event = AuditLog.objects.create(user=self.admin, object_type='invoice', object_id='1', action='create')
        self.client.force_authenticate(self.manager)
        response = self.client.get('/api/audit/?object_type=invoice&object_id=1')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data[0]['id'], event.pk)
        response = self.client.get(f'/api/audit/{event.pk}/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['id'], event.pk)


class ChatPermissionRegressionTests(TransactionTestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='socket-synthetic', password='synthetic-pass')
        self.token = AccessToken.for_user(self.user)

    def socket(self, token=None):
        return WebsocketCommunicator(ChatConsumer.as_asgi(), '/ws/chat/',
                                     subprotocols=['mohaseb-chat', str(token or self.token)])

    async def connect_and_drain(self, socket):
        connected, _ = await socket.connect()
        self.assertTrue(connected)
        self.assertEqual((await socket.receive_json_from())['type'], 'connected')
        self.assertEqual((await socket.receive_json_from())['type'], 'presence')

    async def test_disabled_chat_cannot_connect(self):
        await database_sync_to_async(UserModuleAccess.objects.create)(user=self.user, chat=False)
        socket = self.socket()
        connected, code = await socket.connect()
        try:
            self.assertFalse(connected)
            self.assertIn(code, (4401, 4403))
        finally:
            await socket.disconnect()

    async def test_revoked_chat_does_not_receive_broadcast(self):
        socket = self.socket()
        await self.connect_and_drain(socket)
        try:
            await database_sync_to_async(UserModuleAccess.objects.create)(user=self.user, chat=False)
            layer = get_channel_layer()
            assert layer is not None
            await layer.group_send('chat_room', {'type': 'chat.message', 'payload': {'sender': 999, 'text': 'Synthetic'}})
            response = await socket.receive_output()
            self.assertEqual(response['type'], 'websocket.close')
            self.assertEqual(response['code'], 4403)
        finally:
            await socket.disconnect()

    async def test_deactivated_user_is_rechecked_on_heartbeat(self):
        socket = self.socket()
        await self.connect_and_drain(socket)
        try:
            await database_sync_to_async(User.objects.filter(pk=self.user.pk).update)(is_active=False)
            await socket.send_json_to({'type': 'heartbeat'})
            self.assertEqual((await socket.receive_output())['type'], 'websocket.close')
        finally:
            await socket.disconnect()

    async def test_deactivated_user_does_not_receive_presence_or_delete_events(self):
        for event in [{'type': 'chat.presence', 'user_id': 999}, {'type': 'chat.deleted', 'message_id': 999}]:
            with self.subTest(event=event):
                socket = self.socket()
                await self.connect_and_drain(socket)
                try:
                    await database_sync_to_async(User.objects.filter(pk=self.user.pk).update)(is_active=False)
                    layer = get_channel_layer()
                    assert layer is not None
                    await layer.group_send('chat_room', event)
                    self.assertEqual((await socket.receive_output())['type'], 'websocket.close')
                finally:
                    await socket.disconnect()
                    await database_sync_to_async(User.objects.filter(pk=self.user.pk).update)(is_active=True)

    async def test_socket_closes_when_access_token_expires_without_client_activity(self):
        self.token['exp'] = int(timezone.now().timestamp()) + 2
        socket = self.socket()
        await self.connect_and_drain(socket)
        try:
            response = await socket.receive_output(timeout=3)
            self.assertEqual(response['type'], 'websocket.close')
            self.assertEqual(response['code'], 4401)
        finally:
            await socket.disconnect()

    async def test_idle_revocation_is_bounded_without_broadcast_or_heartbeat(self):
        # Shorten only the recheck period, not permission evaluation.
        with patch.object(ChatConsumer, 'permission_check_interval', 0.02):
            socket = self.socket()
            await self.connect_and_drain(socket)
            try:
                await database_sync_to_async(UserModuleAccess.objects.create)(user=self.user, chat=False)
                response = await socket.receive_output(timeout=1)
                self.assertEqual(response['type'], 'websocket.close')
            finally:
                await socket.disconnect()

    async def test_deleted_user_is_closed_on_heartbeat(self):
        socket = self.socket()
        await self.connect_and_drain(socket)
        try:
            await database_sync_to_async(User.objects.filter(pk=self.user.pk).delete)()
            await socket.send_json_to({'type': 'heartbeat'})
            self.assertEqual((await socket.receive_output())['type'], 'websocket.close')
        finally:
            await socket.disconnect()
