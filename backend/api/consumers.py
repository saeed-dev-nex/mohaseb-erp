import asyncio
from contextlib import suppress

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.contrib.auth import get_user_model
from django.utils import timezone
from .alerts import ALERTS_GROUP
from .models import ChatPresence
from .module_access import effective_modules
from rest_framework_simplejwt.tokens import AccessToken
from rest_framework_simplejwt.exceptions import TokenError


class ChatConsumer(AsyncJsonWebsocketConsumer):
    permission_check_interval = 30

    async def connect(self):
        protocols = self.scope.get('subprotocols', [])
        token = protocols[1] if len(protocols) > 1 and protocols[0] == 'mohaseb-chat' else None
        if not token:
            await self.close(code=4401)
            return

        try:
            access_token = AccessToken(token)
            self.user_id = access_token['user_id']
            self.token_expires_at = access_token['exp']
        except (TokenError, KeyError, TypeError, ValueError):
            await self.close(code=4401)
            return

        if not await self.ensure_authorized():
            return

        self.group_name = 'chat_room'
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept(subprotocol='mohaseb-chat')
        await self.touch_presence(self.user_id)
        await self.channel_layer.group_send(self.group_name, {'type': 'chat.presence', 'user_id': self.user_id})
        await self.send_json({'type': 'connected'})
        self.permission_task = asyncio.create_task(self.monitor_permissions())

    async def disconnect(self, code):
        task = getattr(self, 'permission_task', None)
        if task:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
        group_name = getattr(self, 'group_name', None)
        if group_name:
            await self.channel_layer.group_discard(group_name, self.channel_name)

    async def chat_message(self, event):
        if not await self.ensure_authorized():
            return
        message = event['payload']
        if not message.get('recipient') or self.user_id in (message.get('sender'), message.get('recipient')):
            await self.send_json({'type': 'message', 'message': message})

    async def chat_presence(self, event):
        if not await self.ensure_authorized():
            return
        await self.send_json({'type': 'presence', 'user_id': event['user_id']})

    async def chat_deleted(self, event):
        if not await self.ensure_authorized():
            return
        await self.send_json({'type': 'deleted', 'message_id': event['message_id']})

    async def receive_json(self, content, **kwargs):
        if not await self.ensure_authorized():
            return
        if content.get('type') == 'heartbeat':
            await self.touch_presence(self.user_id)

    async def ensure_authorized(self):
        if getattr(self, 'authorization_closed', False):
            return False
        code = None
        if timezone.now().timestamp() >= self.token_expires_at:
            code = 4401
        elif not await self.user_can_chat(self.user_id):
            code = 4403
        if code is None:
            return True
        # Stop delivery immediately, including queued group events. The timer
        # also bounds revocation for sockets that never send another heartbeat.
        self.authorization_closed = True
        if getattr(self, 'group_name', None):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)
        await self.close(code=code)
        return False

    async def monitor_permissions(self):
        while not getattr(self, 'authorization_closed', False):
            remaining = self.token_expires_at - timezone.now().timestamp()
            await asyncio.sleep(max(0.01, min(self.permission_check_interval, remaining)))
            if not await self.ensure_authorized():
                return

    @database_sync_to_async
    def touch_presence(self, user_id):
        ChatPresence.objects.update_or_create(user_id=user_id, defaults={'last_seen': timezone.now()})

    @database_sync_to_async
    def user_can_chat(self, user_id):
        # Use a fresh user and module row each time; cached scope/relation data
        # must not preserve permissions after an administrator revokes them.
        user = get_user_model().objects.filter(pk=user_id, is_active=True).select_related('module_access').first()
        return user is not None and 'chat' in effective_modules(user)


def alert_should_deliver(payload, *, user_id, is_manager):
    """Who sees an alert event (pure; unit-tested).

    A new edit request concerns managers only. A review outcome
    concerns the requester (their edit access changed) and managers
    (confirmation that a user's edit access was opened or refused).
    """
    kind = payload.get('kind')
    if kind == 'edit_request_created':
        return bool(is_manager)
    if kind == 'edit_request_reviewed':
        return bool(is_manager) or payload.get('requested_by_id') == user_id
    return False


class AlertsConsumer(AsyncJsonWebsocketConsumer):
    """Lightweight real-time alerts socket for every signed-in user.

    Unlike chat it has no module gate: an operator who may not use
    chat must still learn in real time that a manager approved their
    invoice edit request. Delivery is filtered per event by
    alert_should_deliver, using fresh role flags from the database.
    """

    async def connect(self):
        protocols = self.scope.get('subprotocols', [])
        token = protocols[1] if len(protocols) > 1 and protocols[0] == 'mohaseb-alerts' else None
        if not token:
            await self.close(code=4401)
            return
        try:
            access_token = AccessToken(token)
            # SimpleJWT serializes the user_id claim as a string; the
            # alert payloads carry the ORM int — normalize once here so
            # the per-event identity comparison can match.
            self.user_id = int(access_token['user_id'])
            self.token_expires_at = access_token['exp']
        except (TokenError, KeyError, TypeError, ValueError):
            await self.close(code=4401)
            return
        if timezone.now().timestamp() >= self.token_expires_at:
            await self.close(code=4401)
            return
        if await self.user_is_manager(self.user_id) is None:
            await self.close(code=4403)
            return
        self.group_name = ALERTS_GROUP
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept(subprotocol='mohaseb-alerts')
        await self.send_json({'type': 'connected'})

    async def disconnect(self, code):
        group_name = getattr(self, 'group_name', None)
        if group_name:
            await self.channel_layer.group_discard(group_name, self.channel_name)

    async def alerts_event(self, event):
        if timezone.now().timestamp() >= self.token_expires_at:
            await self.close(code=4401)
            return
        is_manager = await self.user_is_manager(self.user_id)
        if is_manager is None:
            await self.close(code=4403)
            return
        if alert_should_deliver(event['payload'], user_id=self.user_id, is_manager=is_manager):
            await self.send_json({'type': 'alert', 'alert': event['payload']})

    @database_sync_to_async
    def user_is_manager(self, user_id):
        """True/False for an active user, None when missing/inactive."""
        user = (
            get_user_model().objects.filter(pk=user_id, is_active=True)
            .only('is_staff', 'is_superuser').first()
        )
        if user is None:
            return None
        return bool(user.is_staff or user.is_superuser)
