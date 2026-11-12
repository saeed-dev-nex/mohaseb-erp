from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('api', '0013_invoice_paid_by'),
    ]

    operations = [
        migrations.AlterModelOptions(
            name='invoiceitem',
            options={'ordering': ['id'], 'verbose_name': 'آیتم فاکتور', 'verbose_name_plural': 'آیتم‌های فاکتور'},
        ),
        migrations.AddField(
            model_name='invoice',
            name='card_payment_source',
            field=models.CharField(
                choices=[('customer', 'کارت مشتری'), ('office', 'کارت دفتر')],
                default='customer', max_length=20, verbose_name='کارت پرداخت',
            ),
        ),
        migrations.AddField(
            model_name='invoiceitem',
            name='is_office_card_fee',
            field=models.BooleanField(default=False, verbose_name='ردیف واریزی کارت دفتر'),
        ),
        migrations.CreateModel(
            name='InvoiceSettings',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('office_card_fee_threshold', models.DecimalField(
                    decimal_places=0, default=0, max_digits=15,
                    verbose_name='حداقل مبلغ واریزی کارت دفتر (تومان)',
                )),
            ],
            options={
                'verbose_name': 'تنظیمات فاکتور',
                'verbose_name_plural': 'تنظیمات فاکتور',
            },
        ),
    ]
