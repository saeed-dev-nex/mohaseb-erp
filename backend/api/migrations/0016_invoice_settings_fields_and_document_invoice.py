from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0015_invoice_commission_paid_and_green_card_owner'),
    ]

    operations = [
        migrations.AddField(
            model_name='invoicesettings',
            name='show_discount_field',
            field=models.BooleanField(default=True, verbose_name='نمایش فیلد تخفیف در فاکتور'),
        ),
        migrations.AddField(
            model_name='invoicesettings',
            name='show_tax_field',
            field=models.BooleanField(default=True, verbose_name='نمایش فیلد مالیات در فاکتور'),
        ),
        migrations.AddField(
            model_name='document',
            name='invoice',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='documents', to='api.invoice'),
        ),
    ]
