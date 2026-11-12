"""Real-time alert broadcasts (invoice edit requests today).

Events go to the shared ``alerts_room`` channel group; AlertsConsumer
decides per connection whether the signed-in user should see each one.
Broadcasting is best-effort: a channel-layer failure must never break
the request that triggered the alert.
"""

import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

logger = logging.getLogger(__name__)

ALERTS_GROUP = 'alerts_room'


def _display_name(user):
    if user is None:
        return ''
    return user.get_full_name() or user.username


def edit_request_payload(kind, edit_request):
    invoice = edit_request.invoice
    return {
        'kind': kind,
        'request_id': edit_request.id,
        'invoice_id': invoice.id if invoice else None,
        'invoice_number': invoice.invoice_number if invoice else '',
        'requested_by_id': edit_request.requested_by_id,
        'requested_by': _display_name(edit_request.requested_by),
        'reviewed_by_id': edit_request.reviewed_by_id,
        'reviewed_by': _display_name(edit_request.reviewed_by),
        'status': edit_request.status,
    }


def broadcast_alert(payload):
    try:
        layer = get_channel_layer()
        if layer is None:
            return
        async_to_sync(layer.group_send)(
            ALERTS_GROUP,
            {'type': 'alerts.event', 'payload': payload},
        )
    except Exception:
        logger.exception('Could not broadcast alert %s', payload.get('kind'))


def notify_edit_request_created(edit_request):
    broadcast_alert(edit_request_payload('edit_request_created', edit_request))


def notify_edit_request_reviewed(edit_request):
    broadcast_alert(edit_request_payload('edit_request_reviewed', edit_request))
