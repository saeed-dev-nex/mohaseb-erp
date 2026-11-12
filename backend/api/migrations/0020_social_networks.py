from django.db import migrations, models
import django.db.models.deletion


def migrate_legacy_social_links(apps, schema_editor):
    BusinessProfile = apps.get_model('api', 'BusinessProfile')
    SocialNetwork = apps.get_model('api', 'SocialNetwork')
    profile = BusinessProfile.objects.filter(pk=1).first()
    if not profile:
        return

    for field, name, base_url in (
        ('instagram', 'اینستاگرام', 'https://instagram.com/'),
        ('telegram', 'تلگرام', 'https://t.me/'),
    ):
        address = (getattr(profile, field) or '').strip()
        if not address:
            continue
        if address.startswith(('http://', 'https://')):
            url = address
        elif address.startswith('www.'):
            url = f'https://{address}'
        else:
            url = base_url + address.lstrip('@').strip('/')
        SocialNetwork.objects.create(profile_id=profile.pk, name=name, url=url)


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0019_welcome_messages'),
    ]

    operations = [
        migrations.CreateModel(
            name='SocialNetwork',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=80, verbose_name='نام شبکه اجتماعی')),
                ('url', models.URLField(max_length=500, verbose_name='نشانی شبکه اجتماعی')),
                ('logo', models.ImageField(blank=True, null=True, upload_to='social_networks/', verbose_name='لوگوی شبکه اجتماعی')),
                ('profile', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='social_links', to='api.businessprofile')),
            ],
            options={
                'verbose_name': 'شبکه اجتماعی',
                'verbose_name_plural': 'شبکه‌های اجتماعی',
                'ordering': ['id'],
            },
        ),
        migrations.RunPython(migrate_legacy_social_links, migrations.RunPython.noop),
    ]
