from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0018_chatmessage_recipient_chatpresence'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='WelcomeSettings',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('enabled', models.BooleanField(default=False, verbose_name='نمایش پیام خوش‌آمدگویی')),
                ('global_message', models.TextField(blank=True, default='', verbose_name='پیام خوش‌آمدگویی عمومی')),
            ],
            options={'verbose_name': 'تنظیمات پیام خوش‌آمدگویی', 'verbose_name_plural': 'تنظیمات پیام خوش‌آمدگویی'},
        ),
        migrations.CreateModel(
            name='UserWelcomeMessage',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('message', models.TextField(verbose_name='پیام شخصی خوش‌آمدگویی')),
                ('user', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='welcome_message', to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.CreateModel(
            name='WelcomeMessageShown',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('date', models.DateField()),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='welcome_messages_shown', to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.AddConstraint(
            model_name='welcomemessageshown',
            constraint=models.UniqueConstraint(fields=('user', 'date'), name='unique_welcome_shown_per_user_day'),
        ),
    ]
