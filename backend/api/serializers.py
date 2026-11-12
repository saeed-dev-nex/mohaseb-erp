from rest_framework import serializers
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ObjectDoesNotExist, ValidationError as DjangoValidationError
from django.db import transaction
from decimal import Decimal
from rest_framework_simplejwt.exceptions import InvalidToken
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from .models import (
    Customer, Service, ServicePackage, Invoice, InvoiceItem, InvoicePayment, AuditLog, Document,
    BusinessProfile, ExpenseCategory, Expense, Staff, VehicleType, BackupConfig,
    Cheque, InvoiceSettings, ChatMessage, SocialNetwork, UserModuleAccess,
    Business, FiscalYear, BusinessMembership,
    Product, Warehouse, StockMovement, PurchaseInvoice, PurchaseLine,
    EmploymentProfile, PayrollPeriod, PayrollSettings, Payslip,
    TaxSettings, MoadianSubmission, FixedAsset, DepreciationRun, DepreciationLine,
)
from .validators import validate_customer_documents_path, validate_customer_identifier, validate_national_code_field, validate_tax_id
from .services.money import invoice_payment_totals, final_amount, office_card_fee, compute_rounding_adjustment, MAX_INVOICE_AMOUNT, MAX_ITEM_AMOUNT


class SafeTokenRefreshSerializer(TokenRefreshSerializer):
    """Treat refresh tokens for deleted users as invalid instead of a 500."""

    def validate(self, attrs):
        try:
            return super().validate(attrs)
        except ObjectDoesNotExist:
            # SimpleJWT looks up the token's user after validating its signature.
            # A user may have been removed since the token was issued.
            raise InvalidToken("Token is invalid or expired")


class UserModuleAccessSerializer(serializers.ModelSerializer):
    """Per-user module restriction row (stage 6)."""

    class Meta:
        model = UserModuleAccess
        fields = ['invoices', 'customers', 'services', 'expenses', 'cheques',
                  'reports', 'chat', 'staff', 'settings', 'users', 'backup']


class UserSerializer(serializers.ModelSerializer):
    """Serializer for operator user management (admin-only)"""
    password = serializers.CharField(write_only=True, required=False, allow_blank=True)
    role = serializers.SerializerMethodField()
    modules = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'last_name', 'email',
                  'is_active', 'is_staff', 'is_superuser', 'role', 'modules',
                  'password', 'date_joined']
        read_only_fields = ['date_joined']

    def get_modules(self, obj):
        from .module_access import effective_modules
        return sorted(effective_modules(obj))

    def get_role(self, obj):
        if obj.is_superuser:
            return 'admin'
        elif obj.is_staff:
            return 'manager'
        return 'operator'

    def validate(self, attrs):
        password = attrs.get('password')
        if password:
            candidate = User(**{field: attrs.get(field, getattr(self.instance, field, ''))
                                for field in ('username', 'first_name', 'last_name', 'email')})
            try:
                validate_password(password, user=candidate)
            except DjangoValidationError as exc:
                raise serializers.ValidationError({'password': exc.messages})
        return attrs

    def create(self, validated_data):
        password = validated_data.pop('password', None)
        user = User(**validated_data)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save()
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop('password', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        if password:
            instance.set_password(password)
        instance.save()
        return instance


class DocumentSerializer(serializers.ModelSerializer):
    file = serializers.FileField(write_only=True)
    file_name = serializers.SerializerMethodField()
    file_url = serializers.SerializerMethodField()
    preview_url = serializers.SerializerMethodField()
    is_image = serializers.SerializerMethodField()
    content_type = serializers.SerializerMethodField()

    class Meta:
        model = Document
        fields = ['id', 'customer', 'invoice', 'title', 'file', 'file_name', 'file_url', 'preview_url', 'is_image', 'content_type', 'description', 'tags', 'uploaded_at', 'updated_at']
        read_only_fields = ['uploaded_at', 'updated_at', 'file_url']

    def get_file_name(self, obj):
        return obj.file.name.replace('\\', '/').rsplit('/', 1)[-1] if obj.file else ''

    def get_file_url(self, obj):
        if obj.file:
            from rest_framework.reverse import reverse
            return reverse('document-download', args=[obj.pk], request=self.context.get('request'))
        return None

    def get_preview_url(self, obj):
        if obj.file:
            from rest_framework.reverse import reverse
            return reverse('document-preview', args=[obj.pk], request=self.context.get('request'))
        return None

    def get_is_image(self, obj):
        return self.get_content_type(obj).startswith('image/')

    def get_content_type(self, obj):
        import mimetypes
        content_type, _ = mimetypes.guess_type(obj.file.name if obj.file else '')
        return content_type or 'application/octet-stream'

    def validate_title(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('عنوان مدرک الزامی است.')
        return value

    def validate_file(self, value):
        import codecs
        import re
        from pathlib import Path
        from zipfile import BadZipFile, ZipFile

        if value.size > 20 * 1024 * 1024:
            raise serializers.ValidationError('حداکثر حجم سند ۲۰ مگابایت است.')
        extension = Path(value.name).suffix.lower()
        signatures = {
            '.pdf': (b'%PDF-',), '.jpg': (b'\xff\xd8\xff',), '.jpeg': (b'\xff\xd8\xff',),
            '.png': (b'\x89PNG\r\n\x1a\n',), '.gif': (b'GIF87a', b'GIF89a'),
            '.bmp': (b'BM',), '.tif': (b'II*\x00', b'MM\x00*'), '.tiff': (b'II*\x00', b'MM\x00*'),
            '.doc': (b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1',),
            '.xls': (b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1',),
            '.ppt': (b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1',),
        }
        office = {'.docx': 'word/', '.xlsx': 'xl/', '.pptx': 'ppt/'}
        allowed = set(signatures) | set(office) | {'.webp', '.txt', '.csv'}
        if extension not in allowed:
            raise serializers.ValidationError('نوع فایل مجاز نیست؛ سند، تصویر یا فایل متنی معتبر انتخاب کنید.')
        try:
            value.seek(0)
            header = value.read(4096)
            valid = True
            if extension in signatures:
                valid = header.startswith(signatures[extension])
            elif extension == '.webp':
                valid = header.startswith(b'RIFF') and header[8:12] == b'WEBP'
            elif extension in office:
                try:
                    with ZipFile(value) as archive:
                        names = archive.namelist()
                        valid = '[Content_Types].xml' in names and any(name.startswith(office[extension]) for name in names)
                        valid = valid and not any(name.lower().endswith('vbaproject.bin') for name in names)
                except BadZipFile:
                    valid = False
            else:
                try:
                    encoding = 'utf-16' if header.startswith((b'\xff\xfe', b'\xfe\xff')) else 'utf-8-sig'
                    text = codecs.getincrementaldecoder(encoding)().decode(header, final=value.size <= len(header))
                    valid = not re.search(r'<\s*(?:!doctype|html\b|svg\b|script\b|iframe\b|object\b|embed\b)', text, re.I)
                    valid = valid and not header.startswith((b'MZ', b'\x7fELF', b'#!')) and '\x00' not in text
                except UnicodeError:
                    valid = False
            if not valid:
                raise serializers.ValidationError('محتوای فایل با نوع مجاز آن مطابقت ندارد.')
        finally:
            value.seek(0)
        return value

    def validate(self, attrs):
        if 'file_path' in self.initial_data:
            raise serializers.ValidationError({'file_path': 'مسیر فایل توسط سرور تعیین می‌شود.'})
        customer = attrs.get('customer', getattr(self.instance, 'customer', None))
        invoice = attrs.get('invoice', getattr(self.instance, 'invoice', None))
        if invoice and customer and invoice.customer_id != customer.pk:
            raise serializers.ValidationError({'invoice': 'فاکتور باید متعلق به همین مشتری باشد.'})
        return attrs


class BackupConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = BackupConfig
        fields = ['backup_path', 'auto_backup', 'backup_frequency', 'backup_hour', 'last_backup_at', 'last_backup_path',
                  'cloud_enabled', 'cloud_endpoint', 'cloud_bucket', 'cloud_access_key', 'cloud_secret_key',
                  'cloud_passphrase', 'cloud_retention', 'last_cloud_backup_at', 'last_cloud_backup_key',
                  'last_cloud_error']
        read_only_fields = ['last_backup_at', 'last_backup_path', 'last_cloud_backup_at', 'last_cloud_backup_key',
                            'last_cloud_error']
        extra_kwargs = {
            'cloud_secret_key': {'write_only': True},
            'cloud_passphrase': {'write_only': True},
        }


class InvoiceSettingsSerializer(serializers.ModelSerializer):
    office_card_fee_threshold = serializers.DecimalField(max_digits=15, decimal_places=0, min_value=0)

    class Meta:
        model = InvoiceSettings
        fields = [
            'office_card_fee_threshold', 'show_discount_field', 'show_tax_field',
            'show_seller_signature', 'show_buyer_signature', 'enable_invoice_clone',
        ]


class ChatMessageSerializer(serializers.ModelSerializer):
    sender = serializers.IntegerField(source='sender_id', read_only=True)
    sender_name = serializers.SerializerMethodField()
    recipient = serializers.PrimaryKeyRelatedField(queryset=User.objects.filter(is_active=True), required=False, allow_null=True)
    recipient_name = serializers.SerializerMethodField()
    file = serializers.FileField(write_only=True, required=False, allow_null=True)
    file_name = serializers.SerializerMethodField()
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = ChatMessage
        fields = ['id', 'sender', 'sender_name', 'recipient', 'recipient_name', 'text', 'file', 'file_name', 'file_url', 'created_at']
        read_only_fields = ['id', 'sender', 'sender_name', 'file_name', 'file_url', 'created_at']

    def get_sender_name(self, obj):
        return obj.sender.get_full_name().strip() or obj.sender.username

    def get_recipient_name(self, obj):
        if not obj.recipient:
            return 'همهٔ کاربران'
        return obj.recipient.get_full_name().strip() or obj.recipient.username

    def get_file_name(self, obj):
        return obj.file.name.rsplit('/', 1)[-1] if obj.file else ''

    def get_file_url(self, obj):
        if not obj.file:
            return ''
        request = self.context.get('request')
        if not request:
            return ''
        from rest_framework.reverse import reverse
        return reverse('chat-download', args=[obj.pk], request=request)

    def validate_file(self, value):
        if value and value.size > 20 * 1024 * 1024:
            raise serializers.ValidationError('حداکثر حجم فایل پیوست ۲۰ مگابایت است.')
        return value

    def validate_text(self, value):
        if len(value) > 5000:
            raise serializers.ValidationError('حداکثر طول پیام ۵۰۰۰ نویسه است.')
        return value

    def validate(self, attrs):
        if not (attrs.get('text') or '').strip() and not attrs.get('file'):
            raise serializers.ValidationError('متن پیام یا یک فایل پیوست کنید.')
        return attrs


class CustomerFinancialListSerializer(serializers.ListSerializer):
    def to_representation(self, data):
        from django.db.models import prefetch_related_objects
        rows = list(data.all() if hasattr(data, 'all') else data)
        prefetch_related_objects(rows, 'invoice_set__payments')
        return super().to_representation(rows)


class CustomerListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for list views (also handles create/update)"""
    total_invoices = serializers.SerializerMethodField(read_only=True)
    total_paid = serializers.SerializerMethodField(read_only=True)
    total_pending = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = Customer
        list_serializer_class = CustomerFinancialListSerializer
        fields = [
            'id', 'business', 'party_role', 'person_type', 'name', 'phone', 'email', 'national_id',
            'address', 'notes', 'created_at',
            'total_invoices', 'total_paid', 'total_pending',
        ]
        read_only_fields = ['created_at', 'total_invoices', 'total_paid', 'business']

    def get_total_invoices(self, obj):
        return obj.invoice_set.count()

    def get_total_paid(self, obj):
        return int(obj.total_paid)

    def get_total_pending(self, obj):
        return int(obj.total_pending)

    def validate_national_id(self, value):
        """Normalize empty to None, then verify کد ملی checksum / شناسه ملی format."""
        if value == '':
            return None
        return validate_customer_identifier(value)

    def validate_phone(self, value):
        """Convert empty string to None"""
        if value == '':
            return None
        return value

    def validate_email(self, value):
        """Convert empty string to None"""
        if value == '':
            return None
        return value


class CustomerDetailSerializer(serializers.ModelSerializer):
    """Full serializer with documents for detail view (also used for create/update)"""
    documents = DocumentSerializer(many=True, read_only=True)
    total_invoices = serializers.SerializerMethodField(read_only=True)
    total_paid = serializers.SerializerMethodField(read_only=True)
    total_pending = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = Customer
        list_serializer_class = CustomerFinancialListSerializer
        fields = [
            'id', 'business', 'party_role', 'person_type', 'name', 'phone', 'email', 'address',
            'national_id', 'notes', 'created_at', 'updated_at',
            'documents', 'total_invoices', 'total_paid', 'total_pending'
        ]
        read_only_fields = ['created_at', 'updated_at', 'documents', 'total_invoices', 'total_paid', 'total_pending', 'business']

    def get_total_invoices(self, obj):
        return obj.invoice_set.count()

    def get_total_paid(self, obj):
        return int(obj.total_paid)

    def get_total_pending(self, obj):
        return int(obj.total_pending)

    def validate_national_id(self, value):
        if value == '':
            return None
        return validate_customer_identifier(value)

    def validate_phone(self, value):
        if value == '':
            return None
        return value

    def validate_email(self, value):
        if value == '':
            return None
        return value


class ServiceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Service
        fields = [
            'id', 'business', 'title', 'description', 'has_extra', 'extra_label',
            'default_main_price', 'default_extra_price',
            'default_commission', 'commission_label',
            'is_active', 'created_at'
        ]
        read_only_fields = ['created_at', 'business']


class ServicePackageSerializer(serializers.ModelSerializer):
    services = serializers.PrimaryKeyRelatedField(
        many=True, queryset=Service.objects.all()
    )
    service_titles = serializers.SerializerMethodField()

    class Meta:
        model = ServicePackage
        fields = ['id', 'name', 'services', 'service_titles', 'is_active', 'created_at']
        read_only_fields = ['created_at']

    def get_service_titles(self, obj):
        return [{'id': s.id, 'title': s.title} for s in obj.services.all()]


class InvoiceItemSerializer(serializers.ModelSerializer):
    service_title = serializers.SerializerMethodField()
    line_total = serializers.SerializerMethodField()
    line_commission = serializers.SerializerMethodField()
    # Explicitly mark service as optional + nullable so manually-typed rows
    # (where the user types a title but doesn't pick from the service list)
    # don't cause a 400 validation error.
    service = serializers.PrimaryKeyRelatedField(
        queryset=Service.objects.all(),
        required=False,
        allow_null=True,
    )
    product = serializers.PrimaryKeyRelatedField(
        queryset=Product.objects.all(),
        required=False,
        allow_null=True,
    )

    class Meta:
        model = InvoiceItem
        fields = [
            'id', 'service', 'product', 'service_title', 'service_title_snapshot',
            'quantity', 'main_price', 'extra_price', 'commission',
            'notes', 'line_total', 'line_commission', 'is_office_card_fee'
        ]
        read_only_fields = ['is_office_card_fee']

    def get_service_title(self, obj):
        return obj.service_title_snapshot or (obj.service.title if obj.service else '---')

    def get_line_total(self, obj):
        return int((obj.main_price + obj.extra_price) * obj.quantity)

    def get_line_commission(self, obj):
        return int(obj.commission * obj.quantity)


class InvoicePaymentSerializer(serializers.ModelSerializer):
    method_display = serializers.CharField(source='get_method_display', read_only=True)
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = InvoicePayment
        fields = ['id', 'amount', 'method', 'method_display', 'reference', 'note', 'paid_at', 'created_by_name']

    def get_created_by_name(self, obj):
        if not obj.created_by:
            return ''
        return obj.created_by.get_full_name() or obj.created_by.username


class AuditLogSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()
    action_display = serializers.CharField(source='get_action_display', read_only=True)

    class Meta:
        model = AuditLog
        fields = ['id', 'object_type', 'object_id', 'object_label', 'action', 'action_display', 'changes', 'created_at', 'user_name']

    def get_user_name(self, obj):
        if not obj.user:
            return 'کاربر حذف‌شده'
        return obj.user.get_full_name() or obj.user.username


class InvoiceSerializer(serializers.ModelSerializer):
    items = InvoiceItemSerializer(many=True)
    payments = InvoicePaymentSerializer(many=True, read_only=True)
    customer_name = serializers.CharField(source='customer.name', read_only=True)
    operator_name = serializers.SerializerMethodField()
    paid_by_name = serializers.SerializerMethodField()
    final_amount = serializers.SerializerMethodField()
    status_display = serializers.SerializerMethodField()
    edit_request_status = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()
    paid_amount = serializers.SerializerMethodField()
    remaining_amount = serializers.SerializerMethodField()
    # Make financial fields optional with defaults so missing fields don't cause 400s
    commission_total = serializers.DecimalField(
        max_digits=15, decimal_places=0, required=False, default=0, min_value=0
    )
    discount = serializers.DecimalField(
        max_digits=15, decimal_places=0, required=False, default=0, min_value=0
    )
    tax = serializers.DecimalField(
        max_digits=5, decimal_places=2, required=False, default=0, min_value=0, max_value=100
    )
    # Optional manual rounding target (the exact final amount the user
    # wants). Read/write: it is the stored rounding RULE (see
    # _apply_rounding). An explicit null means "auto". The persisted
    # result is rounding_amount, derived server-side in validate().
    rounding_target = serializers.IntegerField(
        required=False, allow_null=True, min_value=0
    )
    rounding_cleared = serializers.SerializerMethodField()

    class Meta:
        model = Invoice
        fields = [
            'id', 'business', 'invoice_number', 'customer', 'customer_name', 'operator_name', 'paid_by_name',
            'card_payment_source',
            'date', 'due_date', 'description', 'total_amount',
            'commission_total', 'discount', 'tax', 'status', 'status_display',
            'commission_paid', 'rounding_enabled', 'rounding_amount', 'rounding_target', 'rounding_show_amount',
            'rounding_cleared',
            'paper_size', 'final_amount', 'items', 'created_at', 'updated_at',
            'inventory_posted', 'sales_journal', 'cogs_journal',
            'edit_request_status', 'can_edit', 'payments', 'paid_amount', 'remaining_amount',
            # vehicle / custom fields
            'vehicle_plate', 'vehicle_vin', 'vehicle_model', 'vehicle_type',
            'vehicle_year', 'custom_fields', 'created_by',
            'green_card_owner_name', 'green_card_owner_national_id', 'tags',
        ]
        read_only_fields = ['invoice_number', 'created_at', 'updated_at', 'created_by', 'rounding_amount', 'business']


    def get_operator_name(self, obj):
      if not obj.created_by: return ''
      return obj.created_by.get_full_name() or obj.created_by.username

    def get_status_display(self, obj):
      # A fully-paid invoice always reads «پرداخت شده»; the commission
      # label only applies while the invoice itself is still unpaid.
      if obj.status != 'paid' and obj.commission_paid:
          return 'کارمزد پرداخت شده'
      return obj.get_status_display()

    def get_paid_by_name(self, obj):
      if not obj.paid_by: return ''
      return obj.paid_by.get_full_name() or obj.paid_by.username

    def get_edit_request_status(self, obj):
      request = self.context.get('request')
      if not request or not request.user.is_authenticated:
          return None
      edit_request = next(iter(sorted((row for row in obj.edit_requests.all() if row.requested_by_id == request.user.pk),
                                     key=lambda row: (row.created_at, row.pk), reverse=True)), None)
      return edit_request.status if edit_request else None

    def get_can_edit(self, obj):
      request = self.context.get('request')
      if not request or not request.user.is_authenticated:
          return False
      if obj.status != 'paid' or request.user.is_staff or request.user.is_superuser:
          return True
      return any(row.requested_by_id == request.user.pk and row.status == 'approved' for row in obj.edit_requests.all())

    def get_rounding_cleared(self, obj):
      # True only when this save dropped a stored manual rounding target
      # because the invoice amounts moved (see _apply_rounding). The flag
      # is set during validate() on this serializer instance.
      return bool(getattr(self, '_rounding_cleared', False))

    def get_final_amount(self, obj):
      return int(obj.final_amount)

    def get_paid_amount(self, obj):
      return int(invoice_payment_totals(obj)[0])

    def get_remaining_amount(self, obj):
      return int(invoice_payment_totals(obj)[1])

    def _calc_total(self, items_data):
        total = Decimal(0)
        for item_data in items_data:
            qty = item_data.get('quantity', 1)
            mp = item_data.get('main_price', 0)
            ep = item_data.get('extra_price', 0)
            total += (Decimal(mp) + Decimal(ep)) * qty
        return total

    def validate_items(self, value):
        if not value:
            raise serializers.ValidationError('حداقل یک ردیف خدمات لازم است.')
        return value

    def _validated_total(self, attrs):
        if 'items' in attrs:
            items = attrs['items']
        elif self.instance:
            items = [{'quantity': item.quantity, 'main_price': item.main_price, 'extra_price': item.extra_price}
                     for item in self.instance.items.all() if not item.is_office_card_fee]
        else:
            items = []
        total = self._calc_total(items)
        source = attrs.get('card_payment_source', getattr(self.instance, 'card_payment_source', 'customer'))
        threshold = InvoiceSettings.objects.filter(pk=1).values_list('office_card_fee_threshold', flat=True).first() or 0
        fee = office_card_fee(total, source, threshold)
        if fee > MAX_ITEM_AMOUNT or total + fee > MAX_INVOICE_AMOUNT or total < 0:
            raise serializers.ValidationError({'items': 'جمع مبالغ از محدودهٔ مجاز بیشتر است.'})
        total += fee
        amount = final_amount(total, *(attrs.get(field, getattr(self.instance, field, 0))
                                      for field in ('tax', 'discount', 'commission_total')))
        if not 0 <= amount <= MAX_INVOICE_AMOUNT:
            raise serializers.ValidationError({'discount': 'مبلغ نهایی باید نامنفی و در محدودهٔ مجاز باشد.'})
        return total

    def validate(self, attrs):
        # Client totals are never trusted; include the generated fee before checking limits.
        attrs['total_amount'] = self._validated_total(attrs)
        self._apply_rounding(attrs)
        return attrs

    def _apply_rounding(self, attrs):
        """Derive rounding_amount from the stored RULE and the trusted base.

        The rule is (rounding_enabled, rounding_target): a manual target
        pins the exact final the user chose; with no target the final
        rounds to the nearest 10,000 Toman (remainders of 5,000+ round
        up). The adjustment is re-derived on EVERY save, so an amount
        change can never leave a stale rounded total behind.

        A stored manual target is one-shot: if the invoice base moved
        since it was set, the rounding is cleared (enabled off, target
        and amount zeroed) and the caller is told via rounding_cleared —
        unless the same payload carries a fresh target for the new base,
        which wins as a new manual entry. A base is the pre-rounding
        final: total + tax - discount + commission. Edits that do not
        move the base (notes, show flag, status) preserve the rule.

        create()/update() re-validate the already-validated data, so
        this must be idempotent on a second pass over the same attrs:
        the target is never popped, and the cleared flag is only ever
        set, never reset, within one request.
        """
        _ABSENT = object()
        instance = self.instance
        target = attrs.get('rounding_target', _ABSENT)
        enabled = attrs.get(
            'rounding_enabled', getattr(instance, 'rounding_enabled', False))
        base = final_amount(
            attrs['total_amount'],
            *(attrs.get(field, getattr(instance, field, 0))
              for field in ('tax', 'discount', 'commission_total')))
        if not enabled:
            attrs['rounding_amount'] = Decimal(0)
            attrs['rounding_target'] = None
            return
        fresh_target = target is not _ABSENT and target is not None
        if instance is not None:
            old_base = final_amount(
                instance.total_amount, instance.tax, instance.discount,
                instance.commission_total)
            old_manual = bool(instance.rounding_enabled
                              and instance.rounding_target is not None)
            # Only when the payload says nothing about the target: an
            # explicit null means "auto from now on", a fresh target
            # means "manual for the new base" — neither is a stale rule.
            if old_manual and base != old_base and target is _ABSENT:
                attrs['rounding_enabled'] = False
                attrs['rounding_target'] = None
                attrs['rounding_amount'] = Decimal(0)
                self._rounding_cleared = True
                return
        effective_target = (
            target if fresh_target
            else target if target is not _ABSENT
            else getattr(instance, 'rounding_target', None))
        adjustment = compute_rounding_adjustment(base, effective_target)
        if not 0 <= int(base) + adjustment <= MAX_INVOICE_AMOUNT:
            raise serializers.ValidationError(
                {'rounding_target': 'مبلغ رندشده باید نامنفی و در محدودهٔ مجاز باشد.'})
        attrs['rounding_amount'] = adjustment

    def _sync_office_card_fee(self, invoice, items_total):
        """Rebuild the generated office-card fee row from trusted invoice data."""
        InvoiceItem.objects.filter(invoice=invoice, is_office_card_fee=True).delete()
        threshold = InvoiceSettings.objects.filter(pk=1).values_list('office_card_fee_threshold', flat=True).first() or 0
        fee = office_card_fee(items_total, invoice.card_payment_source, threshold)
        if fee:
            InvoiceItem.objects.create(
                invoice=invoice,
                service_title_snapshot='واریزی',
                quantity=1,
                main_price=fee,
                extra_price=0,
                commission=0,
                is_office_card_fee=True,
            )
        invoice.total_amount = Decimal(items_total) + fee
        try:
            invoice.clean_fields(exclude=['customer', 'created_by', 'paid_by'])
            invoice.clean()
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.message_dict)
        invoice.save(update_fields=['total_amount', 'updated_at'])

    @transaction.atomic
    def create(self, validated_data):
        validated_data = self.validate(validated_data)
        items_data = validated_data.pop('items')
        # commission_total comes directly from validated_data (manual input)
        invoice = Invoice.objects.create(**validated_data)
        total = self._calc_total(items_data)
        for item_data in items_data:
            svc = item_data.get('service')
            if svc and not item_data.get('service_title_snapshot'):
                item_data['service_title_snapshot'] = svc.title
            InvoiceItem.objects.create(invoice=invoice, **item_data)
        self._sync_office_card_fee(invoice, total)
        return invoice

    @transaction.atomic
    def update(self, instance, validated_data):
        validated_data = self.validate(validated_data)
        items_data = validated_data.pop('items', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        if items_data is not None:
            instance.items.filter(is_office_card_fee=False).delete()
            for item_data in items_data:
                item_data.pop('is_office_card_fee', None)
                svc = item_data.get('service')
                if svc and not item_data.get('service_title_snapshot'):
                    item_data['service_title_snapshot'] = svc.title
                InvoiceItem.objects.create(invoice=instance, **item_data)
        items_total = self._calc_total([
            {'quantity': item.quantity, 'main_price': item.main_price, 'extra_price': item.extra_price}
            for item in instance.items.filter(is_office_card_fee=False)
        ])
        instance.save()
        self._sync_office_card_fee(instance, items_total)
        if hasattr(instance, '_prefetched_objects_cache'):
            instance._prefetched_objects_cache.pop('items', None)
        return instance

    def validate_green_card_owner_national_id(self, value):
        return validate_national_code_field(value)

class DashboardStatsSerializer(serializers.Serializer):
    total_customers = serializers.IntegerField()
    total_invoices = serializers.IntegerField()
    total_revenue = serializers.IntegerField()
    pending_invoices = serializers.IntegerField()
    paid_invoices = serializers.IntegerField()
    monthly_revenue = serializers.ListField(child=serializers.DictField())
    recent_invoices = serializers.ListField(child=serializers.DictField())


class SocialNetworkSerializer(serializers.ModelSerializer):
    logo = serializers.ImageField(required=False, allow_null=True)
    logo_url = serializers.SerializerMethodField()

    class Meta:
        model = SocialNetwork
        fields = ['id', 'name', 'url', 'logo', 'logo_url']
        read_only_fields = ['id', 'logo_url']

    def get_logo_url(self, obj):
        if not obj.logo:
            return None
        request = self.context.get('request')
        return request.build_absolute_uri(obj.logo.url) if request else obj.logo.url


class BusinessProfileSerializer(serializers.ModelSerializer):
    logo_url = serializers.SerializerMethodField()
    social_links = SocialNetworkSerializer(many=True, read_only=True)

    class Meta:
        model = BusinessProfile
        fields = [
            'name', 'subtitle', 'logo', 'logo_url', 'phone', 'mobile',
            'address', 'website', 'instagram', 'telegram',
            'footer_text', 'tax_id', 'customer_documents_path', 'social_links'
        ]

    def get_logo_url(self, obj):
        if obj.logo and hasattr(obj.logo, 'url'):
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.logo.url)
            return obj.logo.url
        return None

    def validate_tax_id(self, value):
        return validate_tax_id(value)

    def validate_customer_documents_path(self, value):
        return validate_customer_documents_path(value)

class ExpenseCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ExpenseCategory
        fields = ['id', 'name', 'icon', 'color']


class ExpenseSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source='category.name', read_only=True, default='')
    category_icon = serializers.CharField(source='category.icon', read_only=True, default='📁')

    class Meta:
        model = Expense
        fields = [
            'id', 'category', 'category_name', 'category_icon',
            'title', 'amount', 'date', 'description', 'created_at'
        ]
        read_only_fields = ['created_at']


class StaffSerializer(serializers.ModelSerializer):
    class Meta:
        model = Staff
        fields = [
            'id', 'name', 'phone', 'specialty',
            'commission_rate', 'is_active', 'created_at'
        ]
        read_only_fields = ['created_at']


class VehicleTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = VehicleType
        fields = ['id', 'name']


class ChequeSerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source='customer.name', read_only=True, default='')
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    type_display = serializers.CharField(source='get_type_display', read_only=True)

    class Meta:
        model = Cheque
        fields = [
            'id', 'customer', 'customer_name', 'cheque_number', 'bank_name', 'branch',
            'amount', 'due_date', 'issue_date', 'status', 'status_display',
            'type', 'type_display', 'description', 'created_at', 'updated_at'
        ]
        read_only_fields = ['created_at', 'updated_at']


# ---------------------------------------------------------------------------
# Mohaseb ERP — businesses, fiscal years, memberships (phase 0)
# ---------------------------------------------------------------------------

from .business_templates import get_template


class FiscalYearSerializer(serializers.ModelSerializer):
    class Meta:
        model = FiscalYear
        fields = ['id', 'business', 'title', 'start_date', 'end_date', 'is_current', 'is_closed', 'created_at']
        read_only_fields = ['created_at']


class BusinessMembershipSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True)

    class Meta:
        model = BusinessMembership
        fields = ['id', 'user', 'username', 'business', 'role', 'is_default', 'created_at']
        read_only_fields = ['created_at']


class BusinessSerializer(serializers.ModelSerializer):
    template_title = serializers.SerializerMethodField()
    terminology = serializers.SerializerMethodField()
    invoice_profile = serializers.SerializerMethodField()
    effective_modules = serializers.SerializerMethodField()
    current_fiscal_year = FiscalYearSerializer(read_only=True)
    my_role = serializers.SerializerMethodField()

    class Meta:
        model = Business
        fields = [
            'id', 'name', 'template_key', 'template_title', 'terminology',
            'invoice_profile',
            'person_type', 'legal_name', 'national_id', 'economic_code',
            'registration_number', 'phone', 'address', 'modules_override',
            'effective_modules', 'current_fiscal_year', 'my_role',
            'is_active', 'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']

    def get_template_title(self, obj):
        return get_template(obj.template_key)['title']

    def get_terminology(self, obj):
        return get_template(obj.template_key)['terminology']

    def get_invoice_profile(self, obj):
        from .business_templates import template_invoice_profile

        return template_invoice_profile(obj.template_key)

    def get_effective_modules(self, obj):
        return obj.effective_modules()

    def get_my_role(self, obj):
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if user is None or not user.is_authenticated:
            return None
        if user.is_superuser:
            return 'owner'
        membership = obj.memberships.filter(user=user).first()
        return membership.role if membership else None


# ---------------------------------------------------------------------------
# Mohaseb ERP — accounting (phase 1)
# ---------------------------------------------------------------------------

from .models import Account, JournalEntry, JournalLine


class AccountSerializer(serializers.ModelSerializer):
    level_label = serializers.SerializerMethodField()
    parent_code = serializers.CharField(source='parent.code', read_only=True, default=None)

    class Meta:
        model = Account
        fields = [
            'id', 'business', 'code', 'title', 'parent', 'parent_code',
            'level', 'level_label', 'nature', 'is_active', 'is_system',
            'created_at',
        ]
        read_only_fields = ['business', 'is_system', 'created_at']

    def get_level_label(self, obj):
        return Account.LEVEL_LABELS.get(obj.level, '')


class JournalLineSerializer(serializers.ModelSerializer):
    account_code = serializers.CharField(source='account.code', read_only=True)
    account_title = serializers.CharField(source='account.title', read_only=True)
    party_name = serializers.CharField(source='party.name', read_only=True, default='')

    class Meta:
        model = JournalLine
        fields = [
            'id', 'account', 'account_code', 'account_title',
            'party', 'party_name', 'description', 'debit', 'credit',
        ]


class JournalEntrySerializer(serializers.ModelSerializer):
    lines = JournalLineSerializer(many=True)
    total_debit = serializers.SerializerMethodField()
    total_credit = serializers.SerializerMethodField()
    is_balanced = serializers.SerializerMethodField()
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = JournalEntry
        fields = [
            'id', 'business', 'fiscal_year', 'number', 'date', 'description',
            'reference', 'status', 'status_display', 'lines',
            'total_debit', 'total_credit', 'is_balanced',
            'created_by', 'created_by_name', 'posted_at',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'business', 'number', 'status', 'created_by', 'posted_at',
            'created_at', 'updated_at',
        ]
        extra_kwargs = {'fiscal_year': {'required': False}}

    def get_total_debit(self, obj):
        return obj.total_debit

    def get_total_credit(self, obj):
        return obj.total_credit

    def get_is_balanced(self, obj):
        return obj.is_balanced

    def get_created_by_name(self, obj):
        if not obj.created_by:
            return ''
        return obj.created_by.get_full_name() or obj.created_by.username

    def validate_lines(self, lines):
        if len(lines) < 2:
            raise serializers.ValidationError('سند حسابداری باید دست‌کم دو سطر داشته باشد.')
        for line in lines:
            debit = line.get('debit') or 0
            credit = line.get('credit') or 0
            if debit > 0 and credit > 0:
                raise serializers.ValidationError('هر سطر فقط می‌تواند بدهکار یا بستانکار باشد.')
            if debit == 0 and credit == 0:
                raise serializers.ValidationError('مبلغ هر سطر باید بزرگ‌تر از صفر باشد.')
            account = line.get('account')
            if account is not None and not account.is_postable:
                raise serializers.ValidationError(
                    f'حساب «{account.code} — {account.title}» معین یا تفصیلی نیست و سند نمی‌خورد.'
                )
        return lines

    def create(self, validated_data):
        lines = validated_data.pop('lines')
        entry = JournalEntry.objects.create(**validated_data)
        for line in lines:
            JournalLine.objects.create(entry=entry, **line)
        return entry

    def update(self, instance, validated_data):
        lines = validated_data.pop('lines', None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()
        if lines is not None:
            instance.lines.all().delete()
            for line in lines:
                JournalLine.objects.create(entry=instance, **line)
        return instance


# ---------------------------------------------------------------------------
# Mohaseb ERP — inventory & purchasing (phase 2)
# ---------------------------------------------------------------------------



class WarehouseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Warehouse
        fields = ['id', 'business', 'name', 'is_default', 'is_active', 'created_at']
        read_only_fields = ['business', 'created_at']


class ProductSerializer(serializers.ModelSerializer):
    current_stock = serializers.SerializerMethodField()
    stock_value = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = [
            'id', 'business', 'code', 'name', 'unit', 'barcode',
            'average_cost', 'sale_price', 'is_active',
            'current_stock', 'stock_value', 'created_at', 'updated_at',
        ]
        read_only_fields = ['business', 'average_cost', 'created_at', 'updated_at']

    def get_current_stock(self, obj):
        annotated = getattr(obj, 'stock_qty', None)
        return annotated if annotated is not None else obj.current_stock

    def get_stock_value(self, obj):
        stock = self.get_current_stock(obj)
        return Decimal(stock) * obj.average_cost


class StockMovementSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source='product.name', read_only=True)
    product_code = serializers.CharField(source='product.code', read_only=True)
    kind_display = serializers.CharField(source='get_kind_display', read_only=True)
    signed_quantity = serializers.SerializerMethodField()

    class Meta:
        model = StockMovement
        fields = [
            'id', 'business', 'product', 'product_name', 'product_code',
            'warehouse', 'kind', 'kind_display', 'quantity', 'signed_quantity',
            'unit_cost', 'source_type', 'source_id', 'date', 'note', 'created_at',
        ]
        read_only_fields = fields

    def get_signed_quantity(self, obj):
        return obj.signed_quantity


class PurchaseLineSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source='product.name', read_only=True)
    product_code = serializers.CharField(source='product.code', read_only=True)
    total = serializers.SerializerMethodField()

    class Meta:
        model = PurchaseLine
        fields = ['id', 'product', 'product_name', 'product_code', 'quantity', 'unit_price', 'total']

    def get_total(self, obj):
        return obj.total


class PurchaseInvoiceSerializer(serializers.ModelSerializer):
    lines = PurchaseLineSerializer(many=True)
    total = serializers.SerializerMethodField()
    supplier_name = serializers.CharField(source='supplier.name', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = PurchaseInvoice
        fields = [
            'id', 'business', 'fiscal_year', 'supplier', 'supplier_name',
            'number', 'date', 'description', 'status', 'status_display',
            'vat_amount', 'journal_entry', 'lines', 'total', 'created_at', 'updated_at',
        ]
        read_only_fields = ['business', 'number', 'status', 'journal_entry', 'created_at', 'updated_at']
        extra_kwargs = {'fiscal_year': {'required': False}}

    def get_total(self, obj):
        return obj.total

    def validate_lines(self, lines):
        if not lines:
            raise serializers.ValidationError('فاکتور خرید باید دست‌کم یک سطر داشته باشد.')
        return lines

    def create(self, validated_data):
        lines = validated_data.pop('lines')
        purchase = PurchaseInvoice.objects.create(**validated_data)
        for line in lines:
            PurchaseLine.objects.create(purchase=purchase, **line)
        return purchase

    def update(self, instance, validated_data):
        lines = validated_data.pop('lines', None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()
        if lines is not None:
            instance.lines.all().delete()
            for line in lines:
                PurchaseLine.objects.create(purchase=instance, **line)
        return instance


# ---------------------------------------------------------------------------
# Mohaseb ERP — personnel & payroll (phase 3)
# ---------------------------------------------------------------------------



class PayrollSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = PayrollSettings
        fields = [
            'id', 'business', 'insurance_employee_rate',
            'insurance_employer_rate', 'overtime_factor', 'tax_brackets',
            'updated_at',
        ]
        read_only_fields = ['business', 'updated_at']


class EmploymentProfileSerializer(serializers.ModelSerializer):
    staff_name = serializers.CharField(source='staff.name', read_only=True)
    contract_type_display = serializers.CharField(source='get_contract_type_display', read_only=True)

    class Meta:
        model = EmploymentProfile
        fields = [
            'id', 'business', 'staff', 'staff_name', 'personnel_code',
            'national_id', 'insurance_number', 'bank_iban',
            'contract_type', 'contract_type_display', 'hire_date',
            'base_salary', 'housing_allowance', 'food_allowance',
            'child_allowance_each', 'children_count', 'is_insured',
            'is_active', 'created_at', 'updated_at',
        ]
        read_only_fields = ['business', 'created_at', 'updated_at']


class PayslipSerializer(serializers.ModelSerializer):
    staff_name = serializers.CharField(source='profile.staff.name', read_only=True)
    personnel_code = serializers.CharField(source='profile.personnel_code', read_only=True)

    class Meta:
        model = Payslip
        fields = [
            'id', 'period', 'profile', 'staff_name', 'personnel_code',
            'days_worked', 'overtime_hours', 'other_additions',
            'other_deductions', 'base_pay', 'housing', 'food', 'child',
            'overtime_pay', 'gross', 'insurance_base',
            'insurance_employee', 'insurance_employer', 'taxable_income',
            'tax', 'net', 'created_at', 'updated_at',
        ]
        read_only_fields = [
            'period', 'profile', 'base_pay', 'housing', 'food', 'child',
            'overtime_pay', 'gross', 'insurance_base',
            'insurance_employee', 'insurance_employer', 'taxable_income',
            'tax', 'net', 'created_at', 'updated_at',
        ]


class PayrollPeriodSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    payslip_count = serializers.SerializerMethodField()
    totals = serializers.SerializerMethodField()

    class Meta:
        model = PayrollPeriod
        fields = [
            'id', 'business', 'year', 'month', 'status', 'status_display',
            'journal_entry', 'payslip_count', 'totals',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['business', 'status', 'journal_entry', 'created_at', 'updated_at']

    def get_payslip_count(self, obj):
        return obj.payslips.count()

    def get_totals(self, obj):
        from decimal import Decimal as _D

        slips = obj.payslips.all()
        return {
            'gross': sum((s.gross for s in slips), _D(0)),
            'net': sum((s.net for s in slips), _D(0)),
            'tax': sum((s.tax for s in slips), _D(0)),
            'insurance_employee': sum((s.insurance_employee for s in slips), _D(0)),
            'insurance_employer': sum((s.insurance_employer for s in slips), _D(0)),
        }


# ---------------------------------------------------------------------------
# Mohaseb ERP — tax & fixed assets (phase 4)
# ---------------------------------------------------------------------------



class TaxSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaxSettings
        fields = ['id', 'business', 'is_vat_registered', 'vat_rate', 'economic_code', 'updated_at']
        read_only_fields = ['business', 'updated_at']


class MoadianSubmissionSerializer(serializers.ModelSerializer):
    invoice_number = serializers.CharField(source='invoice.invoice_number', read_only=True)
    customer_name = serializers.CharField(source='invoice.customer.name', read_only=True, default='')
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = MoadianSubmission
        fields = [
            'id', 'business', 'invoice', 'invoice_number', 'customer_name',
            'status', 'status_display', 'unique_id', 'note', 'submitted_at',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['business', 'created_at', 'updated_at']


class FixedAssetSerializer(serializers.ModelSerializer):
    category_display = serializers.CharField(source='get_category_display', read_only=True)
    monthly_depreciation = serializers.SerializerMethodField()
    book_value = serializers.SerializerMethodField()

    class Meta:
        model = FixedAsset
        fields = [
            'id', 'business', 'code', 'name', 'category', 'category_display',
            'purchase_date', 'cost', 'salvage_value', 'useful_life_years',
            'accumulated_depreciation', 'depreciated_months',
            'monthly_depreciation', 'book_value', 'is_active',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'business', 'accumulated_depreciation', 'depreciated_months',
            'created_at', 'updated_at',
        ]

    def get_monthly_depreciation(self, obj):
        return obj.monthly_depreciation

    def get_book_value(self, obj):
        return obj.book_value


class DepreciationLineSerializer(serializers.ModelSerializer):
    asset_name = serializers.CharField(source='asset.name', read_only=True)
    asset_code = serializers.CharField(source='asset.code', read_only=True)

    class Meta:
        model = DepreciationLine
        fields = ['id', 'asset', 'asset_name', 'asset_code', 'amount']


class DepreciationRunSerializer(serializers.ModelSerializer):
    lines = DepreciationLineSerializer(many=True, read_only=True)

    class Meta:
        model = DepreciationRun
        fields = [
            'id', 'business', 'year', 'month', 'total_amount',
            'journal_entry', 'lines', 'created_at',
        ]
        read_only_fields = fields
