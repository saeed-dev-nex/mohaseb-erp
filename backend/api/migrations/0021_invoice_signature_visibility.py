from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0020_social_networks'),
    ]

    operations = [
        migrations.AddField(
            model_name='invoicesettings',
            name='show_seller_signature',
            field=models.BooleanField(default=True, verbose_name='نمایش مهر و امضای فروشنده'),
        ),
        migrations.AddField(
            model_name='invoicesettings',
            name='show_buyer_signature',
            field=models.BooleanField(default=True, verbose_name='نمایش امضای خریدار'),
        ),
    ]
