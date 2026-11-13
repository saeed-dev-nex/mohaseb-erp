import re
import uuid
from decimal import Decimal

from django.db import models, transaction
from django.contrib.auth.models import User
from django.utils import timezone
from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator, MaxValueValidator
from .services.money import final_amount, invoice_payment_totals, MAX_INVOICE_AMOUNT


def document_upload_path(instance, filename):
    """Store invoice documents under a stable, human-readable private name."""
    def safe_component(value):
        cleaned = ''.join(
            '_' if ch in '<>:"/\\|?*' or ord(ch) < 32 else ch
            for ch in str(value or '')
        ).strip(' .')
        return cleaned or 'بدون-عنوان'

    extension = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
    suffix = f'.{extension}' if extension else ''
    if not instance.invoice_id:
        return f'customer_docs/{safe_component(instance.title)}_{uuid.uuid4().hex[:10]}{suffix}'
    invoice_number = safe_component(instance.invoice.invoice_number if instance.invoice_id else 'بدون-فاکتور')
    title = safe_component(instance.title)
    unique = uuid.uuid4().hex[:10]
    return f'customer_docs/invoices/{invoice_number}/{invoice_number}_{title}_{unique}{suffix}'


class Customer(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, null=True, blank=True)
    # ERP dimension: every transactional record belongs to a Business.
    # Nullable only so pre-ERP rows and code paths keep working; the
    # 0035 data migration assigns the default business to all existing
    # rows, and the API sets it on create from the current business.
    business = models.ForeignKey(
        'Business', on_delete=models.PROTECT, null=True, blank=True,
        related_name='business_customers', verbose_name='کسب‌وکار',
    )
    PARTY_ROLE_CHOICES = [
        ('customer', 'مشتری'),
        ('supplier', 'تأمین‌کننده'),
        ('both', 'مشتری و تأمین‌کننده'),
    ]
    PERSON_TYPE_CHOICES = [
        ('legal', 'حقوقی'),
        ('individual', 'حقیقی'),
    ]

    party_role = models.CharField(
        max_length=16, choices=PARTY_ROLE_CHOICES, default='customer',
        verbose_name='نقش طرف حساب',
    )
    person_type = models.CharField(
        max_length=16, choices=PERSON_TYPE_CHOICES, default='legal',
        verbose_name='نوع شخصیت',
    )
    name = models.CharField(max_length=255, verbose_name='نام')
    phone = models.CharField(max_length=50, blank=True, null=True, verbose_name='تلفن')
    email = models.EmailField(blank=True, null=True, verbose_name='ایمیل')
    address = models.TextField(blank=True, null=True, verbose_name='آدرس')
    national_id = models.CharField(max_length=20, blank=True, null=True, verbose_name='کد ملی / شناسه')
    notes = models.TextField(blank=True, null=True, verbose_name='یادداشت')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'مشتری'
        verbose_name_plural = 'مشتریان'
        indexes = [
            models.Index(fields=['phone'], name='customer_phone_idx'),
            models.Index(fields=['name'], name='customer_name_idx'),
        ]

    def __str__(self):
        return self.name

    @property
    def total_invoices(self):
        return self.invoice_set.count()

    @property
    def total_paid(self):
        return sum((invoice_payment_totals(invoice)[0] for invoice in self.financial_invoices()), Decimal(0))

    def financial_invoices(self):
        from django.db.models import prefetch_related_objects
        prefetch_related_objects([self], 'invoice_set__payments')
        return self.invoice_set.all()

    @property
    def total_pending(self):
        return sum((invoice_payment_totals(invoice)[1] for invoice in self.financial_invoices()
                    if invoice.status == 'pending'), Decimal(0))


class Service(models.Model):
    # ERP dimension (phase 0.5): the services/items catalog is per business.
    business = models.ForeignKey(
        'Business', on_delete=models.PROTECT, null=True, blank=True,
        related_name='business_services', verbose_name='کسب‌وکار',
    )
    title = models.CharField(max_length=255, verbose_name='عنوان')
    description = models.TextField(blank=True, null=True, verbose_name='توضیحات')
    has_extra = models.BooleanField(default=False, verbose_name='دارای خدمت اضافه')
    extra_label = models.CharField(max_length=255, blank=True, null=True, verbose_name='برچسب خدمت اضافه')
    default_main_price = models.DecimalField(max_digits=12, decimal_places=0, default=0, validators=[MinValueValidator(0)], verbose_name='قیمت پایه')
    default_extra_price = models.DecimalField(max_digits=12, decimal_places=0, default=0, validators=[MinValueValidator(0)], verbose_name='قیمت اضافه')
    default_commission = models.DecimalField(max_digits=12, decimal_places=0, default=0, validators=[MinValueValidator(0)], verbose_name='کارمزد پیش‌فرض')
    commission_label = models.CharField(max_length=100, default='کارمزد', blank=True, verbose_name='برچسب کارمزد')
    is_active = models.BooleanField(default=True, verbose_name='فعال')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['title']
        verbose_name = 'خدمت'
        verbose_name_plural = 'خدمات'

    def __str__(self):
        return self.title


class ServicePackage(models.Model):
    """A named, manager-defined bundle of services for one-click invoicing.

    Packages are arranged in Settings by the manager (one per recurring
    need, e.g. «خلافی و عوارض») and applied from the invoice form: every
    service in the package becomes an invoice row with its default prices.
    """

    name = models.CharField(max_length=255, verbose_name='نام پکیج')
    services = models.ManyToManyField(
        Service, related_name='packages', blank=True, verbose_name='خدمات پکیج'
    )
    is_active = models.BooleanField(default=True, verbose_name='فعال')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'پکیج خدمات'
        verbose_name_plural = 'پکیج‌های خدمات'

    def __str__(self):
        return self.name


class InvoiceNumberCounter(models.Model):
    """Singleton row that allocates sequential invoice numbers atomically.

    Replaces the previous ``last invoice id + 1`` scheme, which could hand
    the same number to two invoices created at the same time and could
    reissue the number of a deleted invoice.
    """

    last_number = models.PositiveBigIntegerField(default=0, verbose_name='آخرین شمارهٔ فاکتور')

    class Meta:
        verbose_name = 'شمارندهٔ شماره فاکتور'
        verbose_name_plural = 'شمارندهٔ شماره فاکتور'

    def __str__(self):
        return f'InvoiceNumberCounter(last_number={self.last_number})'

    @classmethod
    def highest_existing_number(cls):
        """Largest numeric suffix among existing ``INV-#####`` numbers.

        Used once, when the counter is first created on a database that
        already has invoices, so numbering continues where it left off.
        Rows whose number is not in INV form fall back to their primary
        key, because legacy numbers were derived from it. The pk of an
        INV-numbered row must NOT be used: on PostgreSQL the pk comes
        from a sequence that runs ahead of the actual data (rolled-back
        transactions, restores with preserved pks), so seeding from it
        would skip invoice numbers after every restore.
        """
        highest = 0
        for pk, number in Invoice.objects.values_list('id', 'invoice_number'):
            match = re.fullmatch(r'INV-(\d+)', number or '')
            if match:
                highest = max(highest, int(match.group(1)))
            elif pk:
                highest = max(highest, pk)
        return highest


class Invoice(models.Model):
    STATUS_CHOICES = [
        ('draft', 'پیش‌نویس'),
        ('pending', 'پرداخت نشده'),
        ('paid', 'پرداخت شده'),
        ('cancelled', 'لغو شده'),
    ]

    PAPER_SIZE_CHOICES = [
        ('a5', 'A5'),
        ('a4', 'A4'),
        ('a6', 'A6'),
    ]

    customer = models.ForeignKey(Customer, on_delete=models.SET_NULL, null=True, blank=True, verbose_name='مشتری')
    business = models.ForeignKey(
        'Business', on_delete=models.PROTECT, null=True, blank=True,
        related_name='business_invoices', verbose_name='کسب‌وکار',
    )
    inventory_posted = models.BooleanField(default=False, verbose_name='در انبار و حسابداری ثبت شده')
    sales_journal = models.ForeignKey(
        'JournalEntry', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='sales_invoices', verbose_name='سند فروش',
    )
    cogs_journal = models.ForeignKey(
        'JournalEntry', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='cogs_invoices', verbose_name='سند بهای تمام‌شده',
    )
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='issued_invoices', verbose_name='صادرکننده')
    paid_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='paid_invoices', verbose_name='پرداخت‌کننده')
    card_payment_source = models.CharField(
        max_length=20,
        choices=[('customer', 'کارت مشتری'), ('office', 'کارت دفتر')],
        default='customer',
        verbose_name='کارت پرداخت',
    )
    date = models.DateTimeField(default=timezone.now, verbose_name='تاریخ')
    due_date = models.DateField(null=True, blank=True, verbose_name='سررسید')
    description = models.TextField(blank=True, null=True, verbose_name='توضیحات')
    total_amount = models.DecimalField(max_digits=15, decimal_places=0, default=0, validators=[MinValueValidator(0)], verbose_name='مبلغ کل')
    commission_total = models.DecimalField(max_digits=15, decimal_places=0, default=0, validators=[MinValueValidator(0)], verbose_name='جمع کارمزد')
    commission_paid = models.BooleanField(default=False, verbose_name='کارمزد پرداخت شده')
    discount = models.DecimalField(max_digits=15, decimal_places=0, default=0, validators=[MinValueValidator(0)], verbose_name='تخفیف')
    tax = models.DecimalField(max_digits=5, decimal_places=2, default=0, validators=[MinValueValidator(0), MaxValueValidator(100)], verbose_name='مالیات (%)')
    rounding_enabled = models.BooleanField(default=False, verbose_name='رند کردن مبلغ فاکتور')
    rounding_amount = models.DecimalField(max_digits=15, decimal_places=0, default=0, verbose_name='تعدیل رند (تومان)')
    # The stored rounding RULE, not the result: a manual target pins the
    # exact final the user chose; None means "auto" (nearest 10,000).
    # rounding_amount is a derived cache, re-computed from this rule and
    # the current totals on every save — a manual target is one-shot:
    # when the invoice amounts move, the serializer clears the rule
    # instead of dragging a stale rounded total along.
    rounding_target = models.DecimalField(max_digits=15, decimal_places=0, null=True, blank=True, default=None, verbose_name='هدف دستی رند (تومان)')
    # Display choice only — never affects the math: when False (default)
    # the invoice shows no rounding row; the adjustment is silently part
    # of the final payable amount.
    rounding_show_amount = models.BooleanField(default=False, verbose_name='نمایش مبلغ رند در فاکتور')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending', verbose_name='وضعیت')
    invoice_number = models.CharField(max_length=50, unique=True, blank=True, verbose_name='شماره فاکتور')
    paper_size = models.CharField(max_length=10, choices=PAPER_SIZE_CHOICES, default='a5', verbose_name='سایز کاغذ')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # Vehicle / Custom fields
    vehicle_plate = models.CharField(max_length=100, blank=True, null=True, verbose_name='شماره پلاک')
    vehicle_vin = models.CharField(max_length=50, blank=True, null=True, verbose_name='شماره VIN')
    vehicle_model = models.CharField(max_length=100, blank=True, null=True, verbose_name='مدل خودرو')
    vehicle_type = models.CharField(max_length=100, blank=True, null=True, verbose_name='نوع خودرو')
    vehicle_year = models.CharField(max_length=10, blank=True, null=True, verbose_name='سال ساخت')
    green_card_owner_name = models.CharField(max_length=255, blank=True, default='', verbose_name='نام صاحب برگ سبز')
    green_card_owner_national_id = models.CharField(max_length=20, blank=True, default='', verbose_name='کد ملی صاحب برگ سبز')
    custom_fields = models.JSONField(default=dict, blank=True, verbose_name='فیلدهای دلخواه')
    tags = models.JSONField(default=list, blank=True, verbose_name='برچسب‌ها')


    class Meta:
        ordering = ['-date']
        verbose_name = 'فاکتور'
        verbose_name_plural = 'فاکتورها'
        indexes = [
            models.Index(fields=['status', 'date'], name='invoice_status_date_idx'),
            models.Index(fields=['due_date'], name='invoice_due_date_idx'),
        ]

    def save(self, *args, **kwargs):
        if not self.invoice_number:
            # Allocate the number from the singleton counter inside a
            # transaction. The old ``last.id + 1`` scheme raced when two
            # users issued invoices at the same time and reused numbers
            # after the newest invoice was deleted.
            with transaction.atomic():
                counter, created = (
                    InvoiceNumberCounter.objects.select_for_update()
                    .get_or_create(pk=1, defaults={'last_number': 0})
                )
                if created:
                    counter.last_number = InvoiceNumberCounter.highest_existing_number()
                counter.last_number += 1
                counter.save(update_fields=['last_number'])
                self.invoice_number = f'INV-{counter.last_number:05d}'
                update_fields = kwargs.get('update_fields')
                if update_fields is not None and 'invoice_number' not in update_fields:
                    kwargs['update_fields'] = list(update_fields) + ['invoice_number']
                super().save(*args, **kwargs)
            return
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.invoice_number} - {self.customer}"

    @property
    def final_amount(self):
        return final_amount(self.total_amount, self.tax, self.discount, self.commission_total) + self.rounding_amount

    def clean(self):
        super().clean()
        if not Decimal(0) <= self.final_amount <= MAX_INVOICE_AMOUNT:
            raise ValidationError({'discount': 'مبلغ نهایی باید نامنفی و در محدودهٔ مجاز باشد.'})

    @property
    def net_commission(self):
        return self.commission_total


class InvoiceItem(models.Model):
    invoice = models.ForeignKey(Invoice, related_name='items', on_delete=models.CASCADE)
    service = models.ForeignKey(Service, on_delete=models.SET_NULL, null=True, blank=True, verbose_name='خدمت')
    product = models.ForeignKey('Product', on_delete=models.SET_NULL, null=True, blank=True, verbose_name='کالا')
    service_title_snapshot = models.CharField(max_length=255, blank=True, verbose_name='عنوان خدمت')
    quantity = models.IntegerField(default=1, validators=[MinValueValidator(1)], verbose_name='تعداد')
    main_price = models.DecimalField(max_digits=12, decimal_places=0, default=0, validators=[MinValueValidator(0)], verbose_name='مبلغ پرداختی')
    extra_price = models.DecimalField(max_digits=12, decimal_places=0, default=0, validators=[MinValueValidator(0)], verbose_name='مبلغ استعلام')
    commission = models.DecimalField(max_digits=12, decimal_places=0, default=0, validators=[MinValueValidator(0)], verbose_name='کارمزد')
    notes = models.CharField(max_length=500, blank=True, null=True, verbose_name='یادداشت')
    staff = models.ForeignKey('Staff', on_delete=models.SET_NULL, null=True, blank=True, verbose_name='تکنسین')
    is_office_card_fee = models.BooleanField(default=False, verbose_name='ردیف واریزی کارت دفتر')

    class Meta:
        ordering = ['id']
        verbose_name = 'آیتم فاکتور'
        verbose_name_plural = 'آیتم‌های فاکتور'

    def save(self, *args, **kwargs):
        if self.service and not self.service_title_snapshot:
            self.service_title_snapshot = self.service.title
        super().save(*args, **kwargs)

    @property
    def service_title(self):
        return self.service_title_snapshot or (self.service.title if self.service else '---')

    @property
    def line_total(self):
        return (self.main_price + self.extra_price) * self.quantity

    @property
    def line_commission(self):
        return self.commission * self.quantity


class InvoiceEditRequest(models.Model):
    STATUS_CHOICES = [
        ('pending', 'در انتظار بررسی'),
        ('approved', 'تأیید شده'),
        ('rejected', 'رد شده'),
        ('used', 'مصرف شده'),
    ]

    invoice = models.ForeignKey(Invoice, related_name='edit_requests', on_delete=models.CASCADE)
    requested_by = models.ForeignKey(User, related_name='invoice_edit_requests', on_delete=models.CASCADE)
    reviewed_by = models.ForeignKey(User, related_name='reviewed_invoice_edit_requests', on_delete=models.SET_NULL, null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    created_at = models.DateTimeField(auto_now_add=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Edit request for {self.invoice_id} by {self.requested_by_id} ({self.status})"


class InvoicePayment(models.Model):
    METHOD_CHOICES = [
        ('cash', 'نقدی'),
        ('card', 'کارت‌خوان'),
        ('transfer', 'کارت‌به‌کارت / حواله'),
        ('other', 'سایر'),
    ]

    invoice = models.ForeignKey(Invoice, related_name='payments', on_delete=models.CASCADE)
    amount = models.DecimalField(max_digits=15, decimal_places=0, validators=[MinValueValidator(1)])
    method = models.CharField(max_length=20, choices=METHOD_CHOICES, default='cash')
    reference = models.CharField(max_length=120, blank=True)
    note = models.CharField(max_length=500, blank=True)
    paid_at = models.DateTimeField(default=timezone.now)
    created_by = models.ForeignKey(User, related_name='invoice_payments', on_delete=models.SET_NULL, null=True, blank=True)

    class Meta:
        ordering = ['-paid_at', '-id']

    def __str__(self):
        return f"{self.invoice.invoice_number}: {self.amount}"


class AuditLog(models.Model):
    ACTION_CHOICES = [
        ('create', 'ایجاد'),
        ('update', 'ویرایش'),
        ('delete', 'حذف'),
        ('payment', 'ثبت پرداخت'),
        ('approval', 'بررسی درخواست'),
    ]
    user = models.ForeignKey(User, related_name='audit_events', on_delete=models.SET_NULL, null=True, blank=True)
    object_type = models.CharField(max_length=40)
    object_id = models.CharField(max_length=64)
    object_label = models.CharField(max_length=255, blank=True)
    action = models.CharField(max_length=20, choices=ACTION_CHOICES)
    changes = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at', '-id']
        indexes = [models.Index(fields=['object_type', 'object_id', '-created_at'], name='idx_audit_object_created')]

    def __str__(self):
        return f"{self.object_type} {self.object_id}: {self.action}"


class Document(models.Model):
    customer = models.ForeignKey(Customer, related_name='documents', on_delete=models.CASCADE)
    invoice = models.ForeignKey(Invoice, related_name='documents', on_delete=models.SET_NULL, null=True, blank=True)
    title = models.CharField(max_length=255, verbose_name='عنوان')
    file = models.FileField(upload_to=document_upload_path, verbose_name='فایل')
    description = models.TextField(blank=True, null=True, verbose_name='توضیحات')
    tags = models.JSONField(default=list, blank=True, verbose_name='تگ‌ها')
    file_path = models.CharField(max_length=1000, blank=True, null=True, verbose_name='مسیر فیزیکی فایل')
    uploaded_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-uploaded_at']
        verbose_name = 'سند'
        verbose_name_plural = 'اسناد'

    def __str__(self):
        return f"{self.title} - {self.customer.name}"


class ChatMessage(models.Model):
    sender = models.ForeignKey(User, related_name='chat_messages', on_delete=models.CASCADE)
    recipient = models.ForeignKey(
        User, related_name='received_chat_messages', on_delete=models.CASCADE,
        blank=True, null=True,
        help_text='خالی بودن این فیلد به‌معنای پیام برای همهٔ کاربران است.',
    )
    text = models.TextField(blank=True, default='')
    file = models.FileField(upload_to='chat_files/%Y/%m/', blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['created_at', 'id']

    def __str__(self):
        recipient = self.recipient.username if self.recipient else 'همه'
        return f'{self.sender.username} → {recipient}: {self.text[:50]}'


class ChatPresence(models.Model):
    """آخرین زمان اتصال WebSocket هر کاربر برای نمایش وضعیت آنلاین."""
    user = models.OneToOneField(User, related_name='chat_presence', on_delete=models.CASCADE)
    last_seen = models.DateTimeField(default=timezone.now, db_index=True)

    def __str__(self):
        return f'{self.user.username}: {self.last_seen}'


class ChatNotification(models.Model):
    recipient = models.ForeignKey(User, related_name='chat_notifications', on_delete=models.CASCADE)
    message = models.ForeignKey(ChatMessage, related_name='notifications', on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at', '-id']
        constraints = [models.UniqueConstraint(fields=['recipient', 'message'], name='unique_chat_notification_recipient')]

    def __str__(self):
        return f'{self.recipient.username} ← {self.message.sender.username}'


class BackupConfig(models.Model):
    """Singleton model for backup configuration"""
    FREQ_CHOICES = [
        ('daily', 'روزانه'),
        ('weekly', 'هفتگی'),
        ('manual', 'دستی'),
    ]
    backup_path = models.CharField(max_length=1000, blank=True, default='', verbose_name='مسیر ذخیره بکاپ')
    auto_backup = models.BooleanField(default=False, verbose_name='بکاپ خودکار')
    backup_frequency = models.CharField(max_length=20, choices=FREQ_CHOICES, default='daily', verbose_name='فرکانس بکاپ')
    backup_hour = models.IntegerField(default=13, verbose_name='ساعت بکاپ خودکار (0-23)')
    last_backup_at = models.DateTimeField(null=True, blank=True, verbose_name='آخرین بکاپ')
    last_backup_path = models.CharField(max_length=1000, blank=True, verbose_name='مسیر آخرین بکاپ')
    cloud_enabled = models.BooleanField(default=False, verbose_name='بکاپ ابری')
    cloud_endpoint = models.CharField(max_length=1000, blank=True, default='https://s3.ir-thr-at1.arvanstorage.ir', verbose_name='نقطهٔ پایانی S3')
    cloud_bucket = models.CharField(max_length=255, blank=True, default='', verbose_name='نام باکت ابری')
    cloud_access_key = models.CharField(max_length=255, blank=True, default='', verbose_name='کلید دسترسی ابری')
    cloud_secret_key = models.CharField(max_length=1000, blank=True, default='', verbose_name='کلید محرمانهٔ ابری')
    cloud_passphrase = models.CharField(max_length=1000, blank=True, default='', verbose_name='گذرواژهٔ رمزنگاری بکاپ ابری')
    cloud_retention = models.IntegerField(default=30, verbose_name='نگهداری نسخه‌های ابری (تعداد)')
    last_cloud_backup_at = models.DateTimeField(null=True, blank=True, verbose_name='آخرین بکاپ ابری')
    last_cloud_backup_key = models.CharField(max_length=1000, blank=True, verbose_name='کلید آخرین بکاپ ابری')
    last_cloud_error = models.CharField(max_length=1000, blank=True, verbose_name='آخرین خطای بکاپ ابری')

    class Meta:
        verbose_name = 'تنظیمات بکاپ'
        verbose_name_plural = 'تنظیمات بکاپ'

    def save(self, *args, **kwargs):
        self.pk = 1
        # Cloud credentials never rest as plaintext: encrypt on every save
        # (idempotent — already-encrypted values pass through unchanged).
        from .secret_store import encrypt_secret

        self.cloud_secret_key = encrypt_secret(self.cloud_secret_key)
        self.cloud_passphrase = encrypt_secret(self.cloud_passphrase)
        super().save(*args, **kwargs)

    def decrypted_cloud_secret_key(self):
        from .secret_store import decrypt_secret

        return decrypt_secret(self.cloud_secret_key)

    def decrypted_cloud_passphrase(self):
        from .secret_store import decrypt_secret

        return decrypt_secret(self.cloud_passphrase)

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def __str__(self):
        return 'پیکربندی بکاپ'


class InvoiceSettings(models.Model):
    """Singleton settings used for office-card deposit fees on invoices."""
    office_card_fee_threshold = models.DecimalField(
        max_digits=15, decimal_places=0, default=0,
        verbose_name='حداقل مبلغ واریزی کارت دفتر (تومان)',
    )
    show_discount_field = models.BooleanField(default=True, verbose_name='نمایش فیلد تخفیف در فاکتور')
    show_tax_field = models.BooleanField(default=True, verbose_name='نمایش فیلد مالیات در فاکتور')
    show_seller_signature = models.BooleanField(default=True, verbose_name='نمایش مهر و امضای فروشنده')
    show_buyer_signature = models.BooleanField(default=True, verbose_name='نمایش امضای خریدار')
    enable_invoice_clone = models.BooleanField(default=True, verbose_name='فعال بودن صدور مشابه فاکتور')

    class Meta:
        verbose_name = 'تنظیمات فاکتور'
        verbose_name_plural = 'تنظیمات فاکتور'

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class WelcomeSettings(models.Model):
    enabled = models.BooleanField(default=False, verbose_name='نمایش پیام خوش‌آمدگویی')
    global_message = models.TextField(blank=True, default='', verbose_name='پیام خوش‌آمدگویی عمومی')

    class Meta:
        verbose_name = 'تنظیمات پیام خوش‌آمدگویی'
        verbose_name_plural = 'تنظیمات پیام خوش‌آمدگویی'

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class UserWelcomeMessage(models.Model):
    user = models.OneToOneField(User, related_name='welcome_message', on_delete=models.CASCADE)
    message = models.TextField(verbose_name='پیام شخصی خوش‌آمدگویی')

    def __str__(self):
        return f'پیام خوش‌آمدگویی برای {self.user.username}'


class WelcomeMessageShown(models.Model):
    user = models.ForeignKey(User, related_name='welcome_messages_shown', on_delete=models.CASCADE)
    date = models.DateField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=['user', 'date'], name='unique_welcome_shown_per_user_day')]


class BusinessProfile(models.Model):
    """Singleton model for business/brand settings"""
    name = models.CharField(max_length=255, default='محاسب پرو', verbose_name='نام مجموعه')
    subtitle = models.CharField(max_length=255, blank=True, default='سیستم مدیریت مالی', verbose_name='زیرعنوان')
    logo = models.ImageField(upload_to='brand/', blank=True, null=True, verbose_name='لوگو')
    phone = models.CharField(max_length=50, blank=True, verbose_name='تلفن')
    mobile = models.CharField(max_length=50, blank=True, verbose_name='موبایل')
    address = models.TextField(blank=True, verbose_name='آدرس')
    website = models.URLField(blank=True, verbose_name='وب‌سایت')
    instagram = models.CharField(max_length=100, blank=True, verbose_name='اینستاگرام')
    telegram = models.CharField(max_length=100, blank=True, verbose_name='تلگرام')
    footer_text = models.CharField(max_length=500, blank=True, verbose_name='متن پاورقی فاکتور')
    tax_id = models.CharField(max_length=50, blank=True, verbose_name='شناسه مالیاتی')
    customer_documents_path = models.CharField(max_length=500, blank=True, default='', verbose_name='مسیر ذخیره‌سازی مدارک مشتریان')

    class Meta:
        verbose_name = 'پروفایل کسب‌وکار'
        verbose_name_plural = 'پروفایل کسب‌وکار'

    def save(self, *args, **kwargs):
        # Ensure only one instance exists (singleton)
        self.pk = 1
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class SocialNetwork(models.Model):
    profile = models.ForeignKey(BusinessProfile, related_name='social_links', on_delete=models.CASCADE)
    name = models.CharField(max_length=80, verbose_name='نام شبکه اجتماعی')
    url = models.URLField(max_length=500, verbose_name='نشانی شبکه اجتماعی')
    logo = models.ImageField(upload_to='social_networks/', blank=True, null=True, verbose_name='لوگوی شبکه اجتماعی')

    class Meta:
        ordering = ['id']
        verbose_name = 'شبکه اجتماعی'
        verbose_name_plural = 'شبکه‌های اجتماعی'

    def __str__(self):
        return self.name


class ExpenseCategory(models.Model):
    """Categories for expenses (rent, salary, utilities, etc.)"""
    name = models.CharField(max_length=100, verbose_name='نام دسته')
    icon = models.CharField(max_length=10, default='📁', verbose_name='آیکون')
    color = models.CharField(max_length=20, default='#6366f1', verbose_name='رنگ')

    class Meta:
        ordering = ['name']
        verbose_name = 'دسته هزینه'
        verbose_name_plural = 'دسته‌های هزینه'

    def __str__(self):
        return self.name


class Expense(models.Model):
    """Track business expenses for profit/loss calculation"""
    category = models.ForeignKey(ExpenseCategory, on_delete=models.SET_NULL, null=True, blank=True, verbose_name='دسته')
    title = models.CharField(max_length=255, verbose_name='عنوان')
    amount = models.DecimalField(max_digits=15, decimal_places=0, validators=[MinValueValidator(1)], verbose_name='مبلغ')
    date = models.DateField(default=timezone.now, verbose_name='تاریخ')
    description = models.TextField(blank=True, verbose_name='توضیحات')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-date']
        verbose_name = 'هزینه'
        verbose_name_plural = 'هزینه‌ها'

    def __str__(self):
        return f"{self.title} - {self.amount}"


class Staff(models.Model):
    """Personnel / technicians for commission tracking"""
    name = models.CharField(max_length=255, verbose_name='نام')
    phone = models.CharField(max_length=50, blank=True, verbose_name='تلفن')
    specialty = models.CharField(max_length=255, blank=True, verbose_name='تخصص')
    commission_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0, validators=[MinValueValidator(0), MaxValueValidator(100)], verbose_name='درصد پورسانت')
    is_active = models.BooleanField(default=True, verbose_name='فعال')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'پرسنل'
        verbose_name_plural = 'پرسنل'

    def __str__(self):
        return self.name


class VehicleType(models.Model):
    name = models.CharField(max_length=100, unique=True, verbose_name='نام خودرو')

    class Meta:
        ordering = ['name']
        verbose_name = 'نوع خودرو'
        verbose_name_plural = 'انواع خودرو'

    def __str__(self):
        return self.name


class Cheque(models.Model):
    STATUS_CHOICES = [
        ('pending', 'در جریان'),
        ('passed', 'پاس شده'),
        ('bounced', 'برگشت خورده'),
        ('returned', 'عودت داده شده'),
    ]

    TYPE_CHOICES = [
        ('incoming', 'دریافتی'),
        ('outgoing', 'پرداختی'),
    ]

    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, verbose_name='مشتری', null=True, blank=True)
    cheque_number = models.CharField(max_length=100, verbose_name='شماره چک')
    bank_name = models.CharField(max_length=255, verbose_name='نام بانک')
    branch = models.CharField(max_length=255, blank=True, null=True, verbose_name='شعبه')
    amount = models.DecimalField(max_digits=15, decimal_places=0, validators=[MinValueValidator(1)], verbose_name='مبلغ چک')
    due_date = models.DateField(verbose_name='تاریخ سررسید')
    issue_date = models.DateField(blank=True, null=True, verbose_name='تاریخ صدور')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending', verbose_name='وضعیت')
    type = models.CharField(max_length=20, choices=TYPE_CHOICES, default='incoming', verbose_name='نوع چک')
    description = models.TextField(blank=True, null=True, verbose_name='توضیحات')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['due_date']
        verbose_name = 'چک'
        verbose_name_plural = 'چک‌ها'
        indexes = [
            models.Index(fields=['status', 'due_date'], name='cheque_status_due_idx'),
        ]

    def __str__(self):
        return f"چک {self.cheque_number} - {self.bank_name} ({self.get_type_display()})"


class UserModuleAccess(models.Model):
    """Per-user module access overrides (stage 6).

    A row only ever *restricts*: the user's role decides the ceiling
    (see api.module_access.effective_modules) and the row intersects with
    it. Users without a row keep exactly the access their role has always
    given them, so existing installs are unaffected until an admin starts
    carving modules away. All fields default to True so creating a row is
    not, by itself, a lockout.
    """

    user = models.OneToOneField(
        User, on_delete=models.CASCADE, related_name='module_access',
        verbose_name='کاربر',
    )
    invoices = models.BooleanField(default=True, verbose_name='فاکتورها')
    customers = models.BooleanField(default=True, verbose_name='مشتریان')
    services = models.BooleanField(default=True, verbose_name='خدمات')
    expenses = models.BooleanField(default=True, verbose_name='هزینه‌ها')
    cheques = models.BooleanField(default=True, verbose_name='چک‌ها')
    reports = models.BooleanField(default=True, verbose_name='گزارشات')
    chat = models.BooleanField(default=True, verbose_name='گفتگو')
    staff = models.BooleanField(default=True, verbose_name='پرسنل')
    accounting = models.BooleanField(default=True, verbose_name='حسابداری')
    inventory = models.BooleanField(default=True, verbose_name='انبار')
    payroll = models.BooleanField(default=True, verbose_name='حقوق و دستمزد')
    tax = models.BooleanField(default=True, verbose_name='مالیات')
    assets = models.BooleanField(default=True, verbose_name='دارایی‌ها')
    settings = models.BooleanField(default=True, verbose_name='تنظیمات')
    users = models.BooleanField(default=True, verbose_name='مدیریت کاربران')
    backup = models.BooleanField(default=True, verbose_name='بکاپ')

    class Meta:
        verbose_name = 'دسترسی ماژولی کاربر'
        verbose_name_plural = 'دسترسی‌های ماژولی کاربران'

    def __str__(self):
        return f'دسترسی ماژولی {self.user}'


class IdempotentSubmission(models.Model):
    """Dedupes retried quick-invoice submissions (offline-queue replays).

    The client generates one UUID per quick-invoice draft and resends the
    same key when a submission is retried after a network failure. The
    unique (user, key) pair lets the retry return the original invoice
    instead of issuing a duplicate. ``invoice`` stays null only when a
    first attempt died before the invoice was created; a later retry with
    the same key then completes the submission.
    """

    key = models.UUIDField(verbose_name='کلید یکتایی ارسال')
    invoice = models.ForeignKey(
        Invoice, on_delete=models.CASCADE, null=True, blank=True,
        related_name='idempotent_submissions', verbose_name='فاکتور',
    )
    created_by = models.ForeignKey(
        User, on_delete=models.CASCADE,
        related_name='idempotent_submissions', verbose_name='کاربر',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'ارسال یکتا'
        verbose_name_plural = 'ارسال‌های یکتا'
        constraints = [
            models.UniqueConstraint(
                fields=['created_by', 'key'],
                name='unique_idempotency_key_per_user',
            ),
        ]

    def __str__(self):
        return f'IdempotentSubmission({self.key} → invoice {self.invoice_id})'


# ---------------------------------------------------------------------------
# Mohaseb ERP — multi-business core (phase 0)
#
# A Business is the tenant dimension of the ERP edition: every
# transactional model carries it (Invoice and Customer from phase 0;
# the rest as their modules land). FiscalYear scopes accounting
# periods per business, and BusinessMembership binds users to the
# businesses they may work in.
# ---------------------------------------------------------------------------

from .business_templates import TEMPLATE_CHOICES, DEFAULT_TEMPLATE_KEY, template_modules


class Business(models.Model):
    """یک کسب‌وکار / شرکت — بُعد اصلی داده در نسخهٔ ERP."""

    PERSON_TYPE_CHOICES = [
        ('legal', 'حقوقی (شرکت / مؤسسه)'),
        ('individual', 'حقیقی (شخص / مغازه)'),
    ]

    name = models.CharField(max_length=255, verbose_name='نام کسب‌وکار')
    template_key = models.CharField(
        max_length=32, choices=TEMPLATE_CHOICES, default=DEFAULT_TEMPLATE_KEY,
        verbose_name='قالب شغلی',
    )
    person_type = models.CharField(
        max_length=16, choices=PERSON_TYPE_CHOICES, default='legal',
        verbose_name='نوع شخصیت',
    )
    legal_name = models.CharField(max_length=255, blank=True, default='', verbose_name='نام قانونی / نام کامل')
    national_id = models.CharField(max_length=20, blank=True, default='', verbose_name='شناسه ملی / کد ملی')
    economic_code = models.CharField(max_length=20, blank=True, default='', verbose_name='کد اقتصادی')
    registration_number = models.CharField(max_length=32, blank=True, default='', verbose_name='شماره ثبت')
    phone = models.CharField(max_length=50, blank=True, default='', verbose_name='تلفن')
    address = models.TextField(blank=True, default='', verbose_name='نشانی')
    # {'disabled': [module...], 'enabled': [module...]} on top of the
    # template's module list; None means "exactly the template".
    modules_override = models.JSONField(null=True, blank=True, verbose_name='تنظیم ماژول‌ها')
    is_active = models.BooleanField(default=True, verbose_name='فعال')
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='created_businesses', verbose_name='سازنده',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['id']
        verbose_name = 'کسب‌وکار'
        verbose_name_plural = 'کسب‌وکارها'

    def __str__(self):
        return self.name

    def effective_modules(self):
        """Template modules adjusted by this business's override."""
        modules = template_modules(self.template_key)
        override = self.modules_override or {}
        disabled = set(override.get('disabled') or [])
        modules = [name for name in modules if name not in disabled]
        for name in override.get('enabled') or []:
            if name not in modules:
                modules.append(name)
        return modules

    @property
    def current_fiscal_year(self):
        return self.fiscal_years.filter(is_current=True).first()


class FiscalYear(models.Model):
    """سال مالی یک کسب‌وکار؛ مبنای دوره‌های حسابداری از فاز ۱."""

    business = models.ForeignKey(
        Business, on_delete=models.CASCADE, related_name='fiscal_years',
        verbose_name='کسب‌وکار',
    )
    title = models.CharField(max_length=64, verbose_name='عنوان')
    start_date = models.DateField(verbose_name='تاریخ شروع')
    end_date = models.DateField(verbose_name='تاریخ پایان')
    is_current = models.BooleanField(default=False, verbose_name='سال جاری')
    is_closed = models.BooleanField(default=False, verbose_name='بسته شده')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-start_date']
        verbose_name = 'سال مالی'
        verbose_name_plural = 'سال‌های مالی'
        constraints = [
            models.UniqueConstraint(fields=['business', 'title'], name='unique_fiscal_year_title_per_business'),
        ]

    def __str__(self):
        return f'{self.business} — {self.title}'

    def clean(self):
        super().clean()
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValidationError('تاریخ پایان سال مالی نمی‌تواند قبل از تاریخ شروع باشد.')


class BusinessMembership(models.Model):
    """عضویت یک کاربر در یک کسب‌وکار، با نقش داخل همان کسب‌وکار."""

    ROLE_CHOICES = [
        ('owner', 'مالک'),
        ('manager', 'مدیر'),
        ('operator', 'اپراتور'),
        ('viewer', 'مشاهده‌گر'),
    ]

    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='business_memberships',
        verbose_name='کاربر',
    )
    business = models.ForeignKey(
        Business, on_delete=models.CASCADE, related_name='memberships',
        verbose_name='کسب‌وکار',
    )
    role = models.CharField(max_length=16, choices=ROLE_CHOICES, default='operator', verbose_name='نقش')
    is_default = models.BooleanField(default=False, verbose_name='کسب‌وکار پیش‌فرض کاربر')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['business', 'user']
        verbose_name = 'عضویت کسب‌وکار'
        verbose_name_plural = 'عضویت‌های کسب‌وکار'
        constraints = [
            models.UniqueConstraint(fields=['user', 'business'], name='unique_business_membership'),
        ]

    def __str__(self):
        return f'{self.user} @ {self.business} ({self.role})'


# ---------------------------------------------------------------------------
# Mohaseb ERP — accounting core (phase 1)
#
# Double-entry bookkeeping per business and fiscal year: a hierarchical
# chart of accounts, journal entries with balanced lines, and posting
# as the gate between drafts and the ledger.
# ---------------------------------------------------------------------------

class Account(models.Model):
    """یک حساب در کدینگ — درخت گروه/کل/معین/تفصیلی."""

    NATURE_CHOICES = [
        ('debit', 'بدهکار'),
        ('credit', 'بستانکار'),
    ]
    LEVEL_LABELS = {1: 'گروه', 2: 'کل', 3: 'معین', 4: 'تفصیلی'}

    business = models.ForeignKey(
        Business, on_delete=models.PROTECT, related_name='accounts',
        verbose_name='کسب‌وکار',
    )
    code = models.CharField(max_length=32, verbose_name='کد حساب')
    title = models.CharField(max_length=255, verbose_name='عنوان حساب')
    parent = models.ForeignKey(
        'self', on_delete=models.CASCADE, null=True, blank=True,
        related_name='children', verbose_name='حساب والد',
    )
    level = models.PositiveSmallIntegerField(default=1, verbose_name='سطح')
    nature = models.CharField(max_length=8, choices=NATURE_CHOICES, default='debit', verbose_name='ماهیت')
    is_active = models.BooleanField(default=True, verbose_name='فعال')
    is_system = models.BooleanField(default=False, verbose_name='سیستمی (کدینگ استاندارد)')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['code']
        verbose_name = 'حساب'
        verbose_name_plural = 'حساب‌ها'
        constraints = [
            models.UniqueConstraint(fields=['business', 'code'], name='unique_account_code_per_business'),
        ]

    def __str__(self):
        return f'{self.code} — {self.title}'

    @property
    def is_postable(self):
        """Only معین (۳) and تفصیلی (۴) accounts accept journal lines."""
        return self.level >= 3


class JournalEntry(models.Model):
    """سند حسابداری — سربرگ سند با شمارهٔ یکتا در هر سال مالی."""

    STATUS_CHOICES = [
        ('draft', 'پیش‌نویس'),
        ('posted', 'ثبت‌شده'),
    ]

    business = models.ForeignKey(
        Business, on_delete=models.PROTECT, related_name='journal_entries',
        verbose_name='کسب‌وکار',
    )
    fiscal_year = models.ForeignKey(
        FiscalYear, on_delete=models.PROTECT, related_name='journal_entries',
        verbose_name='سال مالی',
    )
    number = models.PositiveIntegerField(verbose_name='شماره سند')
    date = models.DateField(verbose_name='تاریخ سند')
    description = models.CharField(max_length=500, blank=True, default='', verbose_name='شرح سند')
    reference = models.CharField(max_length=100, blank=True, default='', verbose_name='شماره مرجع / عطف')
    status = models.CharField(max_length=8, choices=STATUS_CHOICES, default='draft', verbose_name='وضعیت')
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='journal_entries', verbose_name='ثبت‌کننده',
    )
    posted_at = models.DateTimeField(null=True, blank=True, verbose_name='زمان ثبت نهایی')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-date', '-number']
        verbose_name = 'سند حسابداری'
        verbose_name_plural = 'اسناد حسابداری'
        constraints = [
            models.UniqueConstraint(
                fields=['business', 'fiscal_year', 'number'],
                name='unique_journal_number_per_year',
            ),
        ]

    def __str__(self):
        return f'سند {self.number} ({self.get_status_display()})'

    @property
    def total_debit(self):
        return sum((line.debit for line in self.lines.all()), Decimal(0))

    @property
    def total_credit(self):
        return sum((line.credit for line in self.lines.all()), Decimal(0))

    @property
    def is_balanced(self):
        return self.total_debit == self.total_credit and self.total_debit > 0


class JournalLine(models.Model):
    """سطر سند — بدهکار/بستانکار روی یک حساب معین یا تفصیلی."""

    entry = models.ForeignKey(
        JournalEntry, on_delete=models.CASCADE, related_name='lines',
        verbose_name='سند',
    )
    account = models.ForeignKey(
        Account, on_delete=models.PROTECT, related_name='journal_lines',
        verbose_name='حساب',
    )
    party = models.ForeignKey(
        Customer, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='journal_lines', verbose_name='طرف حساب (شخص)',
    )
    description = models.CharField(max_length=500, blank=True, default='', verbose_name='شرح سطر')
    debit = models.DecimalField(max_digits=18, decimal_places=0, default=0, validators=[MinValueValidator(0)], verbose_name='بدهکار')
    credit = models.DecimalField(max_digits=18, decimal_places=0, default=0, validators=[MinValueValidator(0)], verbose_name='بستانکار')

    class Meta:
        ordering = ['id']
        verbose_name = 'سطر سند'
        verbose_name_plural = 'سطرهای سند'

    def clean(self):
        super().clean()
        if (self.debit or 0) > 0 and (self.credit or 0) > 0:
            raise ValidationError('هر سطر سند فقط می‌تواند بدهکار یا بستانکار باشد، نه هر دو.')
        if (self.debit or 0) == 0 and (self.credit or 0) == 0:
            raise ValidationError('مبلغ سطر سند باید بزرگ‌تر از صفر باشد.')


# ---------------------------------------------------------------------------
# Mohaseb ERP — inventory, purchasing and the sales link (phase 2)
#
# Stock is a ledger of movements; a product's current quantity is the
# signed sum of its movements and its cost is the weighted average of
# purchase-ins. Posting a purchase writes movements and a balanced
# journal automatically; a sales invoice carrying product lines does
# the same on creation (revenue + COGS).
# ---------------------------------------------------------------------------

class Warehouse(models.Model):
    """انبار — هر کسب‌وکار دست‌کم یک انبار پیش‌فرض دارد."""

    business = models.ForeignKey(
        Business, on_delete=models.PROTECT, related_name='warehouses',
        verbose_name='کسب‌وکار',
    )
    name = models.CharField(max_length=255, verbose_name='نام انبار')
    is_default = models.BooleanField(default=False, verbose_name='انبار پیش‌فرض')
    is_active = models.BooleanField(default=True, verbose_name='فعال')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['id']
        verbose_name = 'انبار'
        verbose_name_plural = 'انبارها'

    def __str__(self):
        return self.name


class Product(models.Model):
    """کالا — با کد یکتا در هر کسب‌وکار و بهای میانگین موزون."""

    business = models.ForeignKey(
        Business, on_delete=models.PROTECT, related_name='products',
        verbose_name='کسب‌وکار',
    )
    code = models.CharField(max_length=64, verbose_name='کد کالا')
    name = models.CharField(max_length=255, verbose_name='نام کالا')
    unit = models.CharField(max_length=32, default='عدد', verbose_name='واحد')
    barcode = models.CharField(max_length=64, blank=True, default='', verbose_name='بارکد')
    average_cost = models.DecimalField(
        max_digits=18, decimal_places=0, default=0,
        verbose_name='بهای تمام‌شدهٔ میانگین',
    )
    sale_price = models.DecimalField(
        max_digits=18, decimal_places=0, default=0,
        verbose_name='قیمت فروش پیش‌فرض',
    )
    is_active = models.BooleanField(default=True, verbose_name='فعال')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['code']
        verbose_name = 'کالا'
        verbose_name_plural = 'کالاها'
        constraints = [
            models.UniqueConstraint(fields=['business', 'code'], name='unique_product_code_per_business'),
        ]

    def __str__(self):
        return f'{self.code} — {self.name}'

    @property
    def current_stock(self):
        total = Decimal(0)
        for movement in self.movements.all():
            total += movement.signed_quantity
        return total


class StockMovement(models.Model):
    """گردش انبار — سند تغییر موجودی؛ مقدار همیشه مثبت و جهت با نوع مشخص است."""

    KIND_CHOICES = [
        ('in_purchase', 'ورود — خرید'),
        ('out_sale', 'خروج — فروش'),
        ('in_return', 'ورود — برگشت از فروش'),
        ('out_return', 'خروج — برگشت به تأمین‌کننده'),
        ('in_adjust', 'ورود — اصلاحی'),
        ('out_adjust', 'خروج — اصلاحی'),
    ]

    business = models.ForeignKey(
        Business, on_delete=models.PROTECT, related_name='stock_movements',
        verbose_name='کسب‌وکار',
    )
    product = models.ForeignKey(
        Product, on_delete=models.PROTECT, related_name='movements',
        verbose_name='کالا',
    )
    warehouse = models.ForeignKey(
        Warehouse, on_delete=models.PROTECT, related_name='movements',
        verbose_name='انبار',
    )
    kind = models.CharField(max_length=16, choices=KIND_CHOICES, verbose_name='نوع گردش')
    quantity = models.DecimalField(max_digits=14, decimal_places=3, validators=[MinValueValidator(Decimal('0.001'))], verbose_name='مقدار')
    unit_cost = models.DecimalField(max_digits=18, decimal_places=0, default=0, verbose_name='بهای واحد')
    source_type = models.CharField(max_length=32, blank=True, default='', verbose_name='نوع سند مبدأ')
    source_id = models.PositiveIntegerField(null=True, blank=True, verbose_name='شناسهٔ سند مبدأ')
    date = models.DateField(verbose_name='تاریخ')
    note = models.CharField(max_length=500, blank=True, default='', verbose_name='توضیح')
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='stock_movements', verbose_name='ثبت‌کننده',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['date', 'id']
        verbose_name = 'گردش انبار'
        verbose_name_plural = 'گردش‌های انبار'

    @property
    def signed_quantity(self):
        return self.quantity if self.kind.startswith('in_') else -self.quantity

    @property
    def total_cost(self):
        return self.quantity * self.unit_cost


class PurchaseInvoice(models.Model):
    """فاکتور خرید از تأمین‌کننده — با ثبت نهایی، انبار و سند خودکار."""

    STATUS_CHOICES = [
        ('draft', 'پیش‌نویس'),
        ('posted', 'ثبت‌شده'),
    ]

    business = models.ForeignKey(
        Business, on_delete=models.PROTECT, related_name='purchase_invoices',
        verbose_name='کسب‌وکار',
    )
    fiscal_year = models.ForeignKey(
        FiscalYear, on_delete=models.PROTECT, related_name='purchase_invoices',
        verbose_name='سال مالی',
    )
    supplier = models.ForeignKey(
        Customer, on_delete=models.PROTECT, related_name='purchase_invoices',
        verbose_name='تأمین‌کننده',
    )
    number = models.PositiveIntegerField(verbose_name='شماره فاکتور خرید')
    date = models.DateField(verbose_name='تاریخ')
    description = models.CharField(max_length=500, blank=True, default='', verbose_name='شرح')
    status = models.CharField(max_length=8, choices=STATUS_CHOICES, default='draft', verbose_name='وضعیت')
    vat_amount = models.DecimalField(max_digits=18, decimal_places=0, default=0, validators=[MinValueValidator(0)], verbose_name='مالیات بر ارزش افزودهٔ خرید')
    journal_entry = models.ForeignKey(
        JournalEntry, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='purchase_invoices', verbose_name='سند حسابداری',
    )
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='purchase_invoices', verbose_name='ثبت‌کننده',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-date', '-number']
        verbose_name = 'فاکتور خرید'
        verbose_name_plural = 'فاکتورهای خرید'
        constraints = [
            models.UniqueConstraint(
                fields=['business', 'fiscal_year', 'number'],
                name='unique_purchase_number_per_year',
            ),
        ]

    def __str__(self):
        return f'خرید {self.number} از {self.supplier}'

    @property
    def total(self):
        return sum((line.total for line in self.lines.all()), Decimal(0))


class PurchaseLine(models.Model):
    purchase = models.ForeignKey(
        PurchaseInvoice, on_delete=models.CASCADE, related_name='lines',
        verbose_name='فاکتور خرید',
    )
    product = models.ForeignKey(
        Product, on_delete=models.PROTECT, related_name='purchase_lines',
        verbose_name='کالا',
    )
    quantity = models.DecimalField(max_digits=14, decimal_places=3, validators=[MinValueValidator(Decimal('0.001'))], verbose_name='مقدار')
    unit_price = models.DecimalField(max_digits=18, decimal_places=0, validators=[MinValueValidator(0)], verbose_name='قیمت واحد خرید')

    class Meta:
        ordering = ['id']
        verbose_name = 'سطر خرید'
        verbose_name_plural = 'سطرهای خرید'

    @property
    def total(self):
        return self.quantity * self.unit_price


# ---------------------------------------------------------------------------
# Mohaseb ERP — personnel & payroll (phase 3)
#
# A Staff member gains an EmploymentProfile per business (contract and
# pay components). A PayrollPeriod (one Jalali month) holds one Payslip
# per employee; finalizing a period writes a single balanced journal:
# salary expense + employer insurance against net payables, tax
# payable and insurance payable.
# ---------------------------------------------------------------------------

# Default monthly salary-tax brackets (قانون بودجهٔ ۱۴۰۴, monthly split),
# stored per business as JSON so the owner can edit them when the law
# changes: each step is [upper_limit_or_null, rate_percent].
DEFAULT_TAX_BRACKETS = [
    [24000000, 0],
    [30000000, 10],
    [38000000, 15],
    [50000000, 20],
    [66000000, 25],
    [None, 30],
]


class PayrollSettings(models.Model):
    """تنظیمات حقوق هر کسب‌وکار — نرخ‌ها و پلکان مالیات قابل ویرایش."""

    business = models.OneToOneField(
        Business, on_delete=models.CASCADE, related_name='payroll_settings',
        verbose_name='کسب‌وکار',
    )
    insurance_employee_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('7'), verbose_name='درصد بیمه سهم کارمند')
    insurance_employer_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('23'), verbose_name='درصد بیمه سهم کارفرما')
    overtime_factor = models.DecimalField(max_digits=4, decimal_places=2, default=Decimal('1.4'), verbose_name='ضریب اضافه‌کاری')
    tax_brackets = models.JSONField(default=list, blank=True, verbose_name='پلکان مالیات حقوق (ماهانه)')
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'تنظیمات حقوق'
        verbose_name_plural = 'تنظیمات حقوق'

    def save(self, *args, **kwargs):
        if not self.tax_brackets:
            self.tax_brackets = [list(step) for step in DEFAULT_TAX_BRACKETS]
        super().save(*args, **kwargs)


class EmploymentProfile(models.Model):
    """پروندهٔ استخدامی یک نفر در یک کسب‌وکار."""

    CONTRACT_CHOICES = [
        ('official', 'رسمی'),
        ('contract', 'قراردادی'),
        ('daily', 'روزمزد'),
    ]

    business = models.ForeignKey(
        Business, on_delete=models.PROTECT, related_name='employment_profiles',
        verbose_name='کسب‌وکار',
    )
    staff = models.ForeignKey(
        Staff, on_delete=models.CASCADE, related_name='employment_profiles',
        verbose_name='پرسنل',
    )
    personnel_code = models.CharField(max_length=32, blank=True, default='', verbose_name='کد پرسنلی')
    national_id = models.CharField(max_length=16, blank=True, default='', verbose_name='کد ملی')
    insurance_number = models.CharField(max_length=32, blank=True, default='', verbose_name='شماره بیمه')
    bank_iban = models.CharField(max_length=32, blank=True, default='', verbose_name='شماره شبا')
    contract_type = models.CharField(max_length=16, choices=CONTRACT_CHOICES, default='contract', verbose_name='نوع قرارداد')
    hire_date = models.DateField(null=True, blank=True, verbose_name='تاریخ استخدام')
    base_salary = models.DecimalField(max_digits=18, decimal_places=0, default=0, verbose_name='حقوق پایه ماهانه')
    housing_allowance = models.DecimalField(max_digits=18, decimal_places=0, default=0, verbose_name='حق مسکن')
    food_allowance = models.DecimalField(max_digits=18, decimal_places=0, default=0, verbose_name='بن کارگری')
    child_allowance_each = models.DecimalField(max_digits=18, decimal_places=0, default=0, verbose_name='حق اولاد هر فرزند')
    children_count = models.PositiveSmallIntegerField(default=0, verbose_name='تعداد فرزند')
    is_insured = models.BooleanField(default=True, verbose_name='مشمول بیمه')
    is_active = models.BooleanField(default=True, verbose_name='فعال')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['staff__name']
        verbose_name = 'پروندهٔ استخدامی'
        verbose_name_plural = 'پرونده‌های استخدامی'
        constraints = [
            models.UniqueConstraint(fields=['business', 'staff'], name='unique_employment_per_business'),
        ]

    def __str__(self):
        return f'{self.staff.name} — {self.business.name}'


class PayrollPeriod(models.Model):
    """دورهٔ حقوق — یک ماه شمسی برای یک کسب‌وکار."""

    STATUS_CHOICES = [
        ('draft', 'پیش‌نویس'),
        ('finalized', 'نهایی‌شده'),
    ]

    business = models.ForeignKey(
        Business, on_delete=models.PROTECT, related_name='payroll_periods',
        verbose_name='کسب‌وکار',
    )
    year = models.PositiveIntegerField(verbose_name='سال شمسی')
    month = models.PositiveSmallIntegerField(validators=[MinValueValidator(1), MaxValueValidator(12)], verbose_name='ماه شمسی')
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default='draft', verbose_name='وضعیت')
    journal_entry = models.ForeignKey(
        JournalEntry, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='payroll_periods', verbose_name='سند حسابداری',
    )
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='payroll_periods', verbose_name='ایجادکننده',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-year', '-month']
        verbose_name = 'دورهٔ حقوق'
        verbose_name_plural = 'دوره‌های حقوق'
        constraints = [
            models.UniqueConstraint(fields=['business', 'year', 'month'], name='unique_payroll_period'),
        ]

    def __str__(self):
        return f'حقوق {self.year}/{self.month:02d} — {self.business.name}'

    @property
    def days_in_month(self):
        if self.month <= 6:
            return 31
        if self.month <= 11:
            return 30
        # Esfand: 30 in leap years — the Jalali leap rule (33-year cycle).
        return 30 if (self.year % 33) in (1, 5, 9, 13, 17, 22, 26, 30) else 29


class Payslip(models.Model):
    """فیش حقوقی یک کارمند در یک دوره — ورودی‌ها و همهٔ اجزای محاسبه."""

    period = models.ForeignKey(
        PayrollPeriod, on_delete=models.CASCADE, related_name='payslips',
        verbose_name='دورهٔ حقوق',
    )
    profile = models.ForeignKey(
        EmploymentProfile, on_delete=models.PROTECT, related_name='payslips',
        verbose_name='پروندهٔ استخدامی',
    )
    days_worked = models.PositiveSmallIntegerField(default=30, verbose_name='روز کارکرد')
    overtime_hours = models.DecimalField(max_digits=6, decimal_places=2, default=0, validators=[MinValueValidator(0)], verbose_name='ساعات اضافه‌کاری')
    other_additions = models.DecimalField(max_digits=18, decimal_places=0, default=0, validators=[MinValueValidator(0)], verbose_name='سایر مزایا')
    other_deductions = models.DecimalField(max_digits=18, decimal_places=0, default=0, validators=[MinValueValidator(0)], verbose_name='سایر کسورات (مساعده و…)')
    # computed components
    base_pay = models.DecimalField(max_digits=18, decimal_places=0, default=0, verbose_name='حقوق پایه دوره')
    housing = models.DecimalField(max_digits=18, decimal_places=0, default=0, verbose_name='حق مسکن')
    food = models.DecimalField(max_digits=18, decimal_places=0, default=0, verbose_name='بن کارگری')
    child = models.DecimalField(max_digits=18, decimal_places=0, default=0, verbose_name='حق اولاد')
    overtime_pay = models.DecimalField(max_digits=18, decimal_places=0, default=0, verbose_name='اضافه‌کاری')
    gross = models.DecimalField(max_digits=18, decimal_places=0, default=0, verbose_name='جمع ناخالص')
    insurance_base = models.DecimalField(max_digits=18, decimal_places=0, default=0, verbose_name='مبنای بیمه')
    insurance_employee = models.DecimalField(max_digits=18, decimal_places=0, default=0, verbose_name='بیمه سهم کارمند')
    insurance_employer = models.DecimalField(max_digits=18, decimal_places=0, default=0, verbose_name='بیمه سهم کارفرما')
    taxable_income = models.DecimalField(max_digits=18, decimal_places=0, default=0, verbose_name='درآمد مشمول مالیات')
    tax = models.DecimalField(max_digits=18, decimal_places=0, default=0, verbose_name='مالیات')
    net = models.DecimalField(max_digits=18, decimal_places=0, default=0, verbose_name='خالص پرداختی')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['profile__staff__name']
        verbose_name = 'فیش حقوقی'
        verbose_name_plural = 'فیش‌های حقوقی'
        constraints = [
            models.UniqueConstraint(fields=['period', 'profile'], name='unique_payslip_per_period'),
        ]


# ---------------------------------------------------------------------------
# Mohaseb ERP — tax & fixed assets (phase 4)
#
# VAT is reported per Jalali quarter from sales invoices (output) and
# purchase invoices (input); seasonal transactions (مادهٔ ۱۶۹) aggregate
# per counterparty. The مؤدیان side is a submission queue with manual
# status tracking — the live connection stays a provider decision.
# Fixed assets depreciate straight-line, one month per run, with an
# auto-journal into هزینهٔ استهلاک / استهلاک انباشته.
# ---------------------------------------------------------------------------

class TaxSettings(models.Model):
    """تنظیمات مالیاتی هر کسب‌وکار."""

    business = models.OneToOneField(
        Business, on_delete=models.CASCADE, related_name='tax_settings',
        verbose_name='کسب‌وکار',
    )
    is_vat_registered = models.BooleanField(default=True, verbose_name='مشمول ارزش افزوده')
    vat_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('10'), verbose_name='نرخ ارزش افزوده (درصد)')
    economic_code = models.CharField(max_length=32, blank=True, default='', verbose_name='کد اقتصادی')
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'تنظیمات مالیاتی'
        verbose_name_plural = 'تنظیمات مالیاتی'


class MoadianSubmission(models.Model):
    """صف ارسال صورتحساب به سامانهٔ مؤدیان (وضعیت‌ها دستی ثبت می‌شوند)."""

    STATUS_CHOICES = [
        ('queued', 'در صف ارسال'),
        ('sent', 'ارسال شده'),
        ('failed', 'ناموفق'),
    ]

    business = models.ForeignKey(
        Business, on_delete=models.PROTECT, related_name='moadian_submissions',
        verbose_name='کسب‌وکار',
    )
    invoice = models.ForeignKey(
        Invoice, on_delete=models.CASCADE, related_name='moadian_submissions',
        verbose_name='فاکتور',
    )
    status = models.CharField(max_length=8, choices=STATUS_CHOICES, default='queued', verbose_name='وضعیت')
    unique_id = models.CharField(max_length=32, blank=True, default='', verbose_name='شناسهٔ یکتای مالیاتی')
    note = models.CharField(max_length=500, blank=True, default='', verbose_name='توضیح / پاسخ سامانه')
    submitted_at = models.DateTimeField(null=True, blank=True, verbose_name='زمان ارسال')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'ارسال مؤدیان'
        verbose_name_plural = 'ارسال‌های مؤدیان'


class FixedAsset(models.Model):
    """دارایی ثابت — استهلاک خط مستقیم ماهانه."""

    CATEGORY_CHOICES = [
        ('land', 'زمین'),
        ('building', 'ساختمان'),
        ('machinery', 'ماشین‌آلات'),
        ('vehicle', 'وسایل نقلیه'),
        ('equipment', 'تجهیزات و اثاثه'),
        ('software', 'نرم‌افزار'),
        ('other', 'سایر'),
    ]

    business = models.ForeignKey(
        Business, on_delete=models.PROTECT, related_name='fixed_assets',
        verbose_name='کسب‌وکار',
    )
    code = models.CharField(max_length=64, verbose_name='کد دارایی')
    name = models.CharField(max_length=255, verbose_name='نام دارایی')
    category = models.CharField(max_length=16, choices=CATEGORY_CHOICES, default='equipment', verbose_name='گروه دارایی')
    purchase_date = models.DateField(verbose_name='تاریخ خرید')
    cost = models.DecimalField(max_digits=18, decimal_places=0, validators=[MinValueValidator(0)], verbose_name='بهای تمام‌شده')
    salvage_value = models.DecimalField(max_digits=18, decimal_places=0, default=0, validators=[MinValueValidator(0)], verbose_name='ارزش اسقاط')
    useful_life_years = models.PositiveSmallIntegerField(default=5, validators=[MinValueValidator(1)], verbose_name='عمر مفید (سال)')
    accumulated_depreciation = models.DecimalField(max_digits=18, decimal_places=0, default=0, verbose_name='استهلاک انباشته')
    depreciated_months = models.PositiveIntegerField(default=0, verbose_name='ماه‌های استهلاک‌یافته')
    is_active = models.BooleanField(default=True, verbose_name='فعال')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['code']
        verbose_name = 'دارایی ثابت'
        verbose_name_plural = 'دارایی‌های ثابت'
        constraints = [
            models.UniqueConstraint(fields=['business', 'code'], name='unique_asset_code_per_business'),
        ]

    def __str__(self):
        return f'{self.code} — {self.name}'

    @property
    def depreciable_base(self):
        return self.cost - self.salvage_value

    @property
    def monthly_depreciation(self):
        if self.useful_life_years <= 0:
            return Decimal(0)
        return (self.depreciable_base / (self.useful_life_years * 12)).quantize(Decimal('1'))

    @property
    def book_value(self):
        return self.cost - self.accumulated_depreciation

    @property
    def life_months(self):
        return self.useful_life_years * 12

    @property
    def is_fully_depreciated(self):
        return self.accumulated_depreciation >= self.depreciable_base


class DepreciationRun(models.Model):
    """اجرای استهلاک یک ماه — با سند خودکار تجمیعی."""

    business = models.ForeignKey(
        Business, on_delete=models.PROTECT, related_name='depreciation_runs',
        verbose_name='کسب‌وکار',
    )
    year = models.PositiveIntegerField(verbose_name='سال شمسی')
    month = models.PositiveSmallIntegerField(validators=[MinValueValidator(1), MaxValueValidator(12)], verbose_name='ماه شمسی')
    total_amount = models.DecimalField(max_digits=18, decimal_places=0, default=0, verbose_name='جمع استهلاک دوره')
    journal_entry = models.ForeignKey(
        JournalEntry, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='depreciation_runs', verbose_name='سند حسابداری',
    )
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='depreciation_runs', verbose_name='ثبت‌کننده',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-year', '-month']
        verbose_name = 'اجرای استهلاک'
        verbose_name_plural = 'اجراهای استهلاک'
        constraints = [
            models.UniqueConstraint(fields=['business', 'year', 'month'], name='unique_depreciation_run'),
        ]


class DepreciationLine(models.Model):
    run = models.ForeignKey(
        DepreciationRun, on_delete=models.CASCADE, related_name='lines',
        verbose_name='اجرا',
    )
    asset = models.ForeignKey(
        FixedAsset, on_delete=models.PROTECT, related_name='depreciation_lines',
        verbose_name='دارایی',
    )
    amount = models.DecimalField(max_digits=18, decimal_places=0, verbose_name='مبلغ استهلاک ماه')

    class Meta:
        ordering = ['asset__code']
        verbose_name = 'سطر استهلاک'
        verbose_name_plural = 'سطرهای استهلاک'
