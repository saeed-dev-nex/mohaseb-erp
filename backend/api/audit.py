from django.forms.models import model_to_dict

from .models import AuditLog


def snapshot(instance):
    """Return a JSON-safe snapshot of a business record."""
    data = model_to_dict(instance)
    data['id'] = instance.pk
    for key, value in list(data.items()):
        if value is not None and not isinstance(value, (str, int, float, bool, list, dict)):
            data[key] = str(value)
    if instance.__class__.__name__ == 'Invoice':
        data['customer_name'] = instance.customer.name if instance.customer_id else ''
        data['items'] = [
            {
                'id': item.pk,
                'service': item.service_id,
                'staff': item.staff_id,
                'title': item.service_title,
                'quantity': item.quantity,
                'main_price': str(item.main_price),
                'extra_price': str(item.extra_price),
                'commission': str(item.commission),
                'notes': item.notes or '',
                'is_office_card_fee': item.is_office_card_fee,
            }
            for item in instance.items.all()
        ]
    return data


def is_invoice_content_version(event):
    """Whether an audit event represents an editable invoice revision."""
    changes = event.changes or {}
    before, after = changes.get('before'), changes.get('after')
    if event.action != 'update' or not isinstance(before, dict) or not isinstance(after, dict):
        return False
    if not isinstance(before.get('items'), list) or not isinstance(after.get('items'), list):
        return False
    ignored = {'status', 'paid_by'}
    return any(before.get(key) != after.get(key) for key in (set(before) | set(after)) - ignored)


def record_audit(*, user, instance, action, before=None, after=None, label=None):
    label = label or str(instance)
    AuditLog.objects.create(
        user=user if getattr(user, 'is_authenticated', False) else None,
        object_type=instance.__class__.__name__.lower(),
        object_id=str(instance.pk),
        object_label=label[:255],
        action=action,
        changes={'before': before, 'after': after},
    )
