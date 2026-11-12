"""Store the rounding rule (manual target) instead of only its result.

Existing rounded invoices are classified so no payable changes:
- stored adjustment == auto adjustment for the current base -> auto
  (target stays None);
- otherwise the manual target is the current final amount
  (base + stored adjustment), preserving the exact payable.
"""

from decimal import Decimal

from django.db import migrations, models


def classify_rounding(apps, schema_editor):
    from api.services.money import compute_rounding_adjustment, final_amount

    Invoice = apps.get_model('api', 'Invoice')
    for invoice in Invoice.objects.filter(rounding_enabled=True).only(
            'id', 'total_amount', 'tax', 'discount', 'commission_total',
            'rounding_amount'):
        base = final_amount(invoice.total_amount, invoice.tax,
                            invoice.discount, invoice.commission_total)
        if Decimal(invoice.rounding_amount) == compute_rounding_adjustment(base):
            continue  # auto: target stays None
        invoice.rounding_target = base + Decimal(invoice.rounding_amount)
        invoice.save(update_fields=['rounding_target'])


def unclassify_rounding(apps, schema_editor):
    apps.get_model('api', 'Invoice').objects.update(rounding_target=None)


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0033_invoice_rounding_show_amount'),
    ]

    operations = [
        migrations.AddField(
            model_name='invoice',
            name='rounding_target',
            field=models.DecimalField(blank=True, decimal_places=0, default=None, max_digits=15, null=True, verbose_name='هدف دستی رند (تومان)'),
        ),
        migrations.RunPython(classify_rounding, unclassify_rounding),
    ]
