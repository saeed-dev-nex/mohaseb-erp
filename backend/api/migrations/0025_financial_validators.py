"""Validation metadata only: existing values are neither rewritten nor constrained.

Any future database check constraints need a separate legacy-data preflight.
"""

from django.core.validators import MinValueValidator, MaxValueValidator
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('api', '0024_usermoduleaccess')]

    operations = [
        migrations.AlterField(model_name='service', name='default_main_price', field=models.DecimalField(max_digits=12, decimal_places=0, default=0, validators=[MinValueValidator(0)], verbose_name='قیمت پایه')),
        migrations.AlterField(model_name='service', name='default_extra_price', field=models.DecimalField(max_digits=12, decimal_places=0, default=0, validators=[MinValueValidator(0)], verbose_name='قیمت اضافه')),
        migrations.AlterField(model_name='service', name='default_commission', field=models.DecimalField(max_digits=12, decimal_places=0, default=0, validators=[MinValueValidator(0)], verbose_name='کارمزد پیش‌فرض')),
        migrations.AlterField(model_name='invoice', name='total_amount', field=models.DecimalField(max_digits=15, decimal_places=0, default=0, validators=[MinValueValidator(0)], verbose_name='مبلغ کل')),
        migrations.AlterField(model_name='invoice', name='commission_total', field=models.DecimalField(max_digits=15, decimal_places=0, default=0, validators=[MinValueValidator(0)], verbose_name='جمع کارمزد')),
        migrations.AlterField(model_name='invoice', name='discount', field=models.DecimalField(max_digits=15, decimal_places=0, default=0, validators=[MinValueValidator(0)], verbose_name='تخفیف')),
        migrations.AlterField(model_name='invoice', name='tax', field=models.DecimalField(max_digits=5, decimal_places=2, default=0, validators=[MinValueValidator(0), MaxValueValidator(100)], verbose_name='مالیات (%)')),
        migrations.AlterField(model_name='invoiceitem', name='quantity', field=models.IntegerField(default=1, validators=[MinValueValidator(1)], verbose_name='تعداد')),
        migrations.AlterField(model_name='invoiceitem', name='main_price', field=models.DecimalField(max_digits=12, decimal_places=0, default=0, validators=[MinValueValidator(0)], verbose_name='مبلغ پرداختی')),
        migrations.AlterField(model_name='invoiceitem', name='extra_price', field=models.DecimalField(max_digits=12, decimal_places=0, default=0, validators=[MinValueValidator(0)], verbose_name='مبلغ استعلام')),
        migrations.AlterField(model_name='invoiceitem', name='commission', field=models.DecimalField(max_digits=12, decimal_places=0, default=0, validators=[MinValueValidator(0)], verbose_name='کارمزد')),
        migrations.AlterField(model_name='invoicepayment', name='amount', field=models.DecimalField(max_digits=15, decimal_places=0, validators=[MinValueValidator(1)])),
        migrations.AlterField(model_name='expense', name='amount', field=models.DecimalField(max_digits=15, decimal_places=0, validators=[MinValueValidator(1)], verbose_name='مبلغ')),
        migrations.AlterField(model_name='staff', name='commission_rate', field=models.DecimalField(max_digits=5, decimal_places=2, default=0, validators=[MinValueValidator(0), MaxValueValidator(100)], verbose_name='درصد پورسانت')),
        migrations.AlterField(model_name='cheque', name='amount', field=models.DecimalField(max_digits=15, decimal_places=0, validators=[MinValueValidator(1)], verbose_name='مبلغ چک')),
    ]
