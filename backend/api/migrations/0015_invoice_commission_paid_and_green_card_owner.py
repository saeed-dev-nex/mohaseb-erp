from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0014_invoice_payment_source_and_office_card_fee'),
    ]

    operations = [
        migrations.AddField(
            model_name='invoice',
            name='commission_paid',
            field=models.BooleanField(default=False, verbose_name='کارمزد پرداخت شده'),
        ),
        migrations.AddField(
            model_name='invoice',
            name='green_card_owner_name',
            field=models.CharField(blank=True, default='', max_length=255, verbose_name='نام صاحب برگ سبز'),
        ),
        migrations.AddField(
            model_name='invoice',
            name='green_card_owner_national_id',
            field=models.CharField(blank=True, default='', max_length=20, verbose_name='کد ملی صاحب برگ سبز'),
        ),
    ]
