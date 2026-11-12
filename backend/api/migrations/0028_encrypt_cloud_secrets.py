"""Encrypt stored cloud-backup credentials at rest.

BackupConfig rows saved before this migration hold the S3 secret key and
the cloud passphrase as plaintext. Encrypt them in place with the same
scheme the model now applies on save (api/secret_store.py). Values that
are empty or already encrypted are left untouched, so the migration is
idempotent and safe to re-run.
"""

from django.db import migrations


def encrypt_existing_secrets(apps, schema_editor):
    from api.secret_store import encrypt_secret, is_encrypted

    BackupConfig = apps.get_model('api', 'BackupConfig')
    for config in BackupConfig.objects.all():
        changed = []
        for field in ('cloud_secret_key', 'cloud_passphrase'):
            value = getattr(config, field)
            if value and not is_encrypted(value):
                setattr(config, field, encrypt_secret(value))
                changed.append(field)
        if changed:
            # Historical models do not run the overridden save(); write the
            # fields directly so nothing else on the row is touched.
            config.save(update_fields=changed)


def decrypt_existing_secrets(apps, schema_editor):
    from api.secret_store import decrypt_secret, is_encrypted

    BackupConfig = apps.get_model('api', 'BackupConfig')
    for config in BackupConfig.objects.all():
        changed = []
        for field in ('cloud_secret_key', 'cloud_passphrase'):
            value = getattr(config, field)
            if value and is_encrypted(value):
                setattr(config, field, decrypt_secret(value))
                changed.append(field)
        if changed:
            config.save(update_fields=changed)


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0027_cloud_backup'),
    ]

    operations = [
        migrations.RunPython(encrypt_existing_secrets, decrypt_existing_secrets),
    ]
