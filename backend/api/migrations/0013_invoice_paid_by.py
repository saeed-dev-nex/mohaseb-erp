from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def backfill_paid_by(apps, schema_editor):
    Invoice = apps.get_model('api', 'Invoice')
    InvoicePayment = apps.get_model('api', 'InvoicePayment')
    AuditLog = apps.get_model('api', 'AuditLog')

    for invoice in Invoice.objects.filter(status='paid').iterator():
        payment = InvoicePayment.objects.filter(
            invoice_id=invoice.pk,
            created_by__isnull=False,
        ).order_by('-paid_at', '-id').first()
        user_id = payment.created_by_id if payment else None

        if user_id is None:
            events = AuditLog.objects.filter(
                object_type='invoice', object_id=str(invoice.pk), user__isnull=False,
            ).order_by('-created_at', '-id')
            for event in events.iterator():
                changes = event.changes or {}
                before = changes.get('before') or {}
                after = changes.get('after') or {}
                if after.get('status') == 'paid' and before.get('status') != 'paid':
                    user_id = event.user_id
                    break

        if user_id is not None:
            Invoice.objects.filter(pk=invoice.pk).update(paid_by_id=user_id)


class Migration(migrations.Migration):
    dependencies = [
        ('api', '0012_auditlog_invoicepayment'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='invoice',
            name='paid_by',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='paid_invoices',
                to=settings.AUTH_USER_MODEL,
                verbose_name='پرداخت‌کننده',
            ),
        ),
        migrations.RunPython(backfill_paid_by, migrations.RunPython.noop),
    ]
