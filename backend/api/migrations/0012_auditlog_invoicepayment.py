from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):
    dependencies = [
        ('api', '0011_invoice_edit_request'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='AuditLog',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('object_type', models.CharField(max_length=40)),
                ('object_id', models.CharField(max_length=64)),
                ('object_label', models.CharField(blank=True, max_length=255)),
                ('action', models.CharField(choices=[('create', 'ایجاد'), ('update', 'ویرایش'), ('delete', 'حذف'), ('payment', 'ثبت پرداخت'), ('approval', 'بررسی درخواست')], max_length=20)),
                ('changes', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('user', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='audit_events', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['-created_at', '-id']},
        ),
        migrations.CreateModel(
            name='InvoicePayment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('amount', models.DecimalField(decimal_places=0, max_digits=15)),
                ('method', models.CharField(choices=[('cash', 'نقدی'), ('card', 'کارت‌خوان'), ('transfer', 'کارت‌به‌کارت / حواله'), ('other', 'سایر')], default='cash', max_length=20)),
                ('reference', models.CharField(blank=True, max_length=120)),
                ('note', models.CharField(blank=True, max_length=500)),
                ('paid_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='invoice_payments', to=settings.AUTH_USER_MODEL)),
                ('invoice', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='payments', to='api.invoice')),
            ],
            options={'ordering': ['-paid_at', '-id']},
        ),
        migrations.AddIndex(
            model_name='auditlog',
            index=models.Index(fields=['object_type', 'object_id', '-created_at'], name='idx_audit_object_created'),
        ),
    ]
