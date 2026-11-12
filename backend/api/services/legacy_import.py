"""Import a mohaseb-pro backup payload into one ERP business (phase 5).

The backup format is the shared ``mohaseb-backup-v1`` fixture list.
This importer is *additive*: it never deletes or overwrites — legacy
customers, services, staff, invoices and their items are created
scoped to the target business, invoices whose number already exists
in the business are skipped, and customers are reused when one with
the same national id (or phone) already exists in the business.
Encrypted backups are refused with a clear message: take an
unencrypted export from mohaseb-pro first.
"""

from django.db import transaction
from django.utils.dateparse import parse_date, parse_datetime

from ..backup_utils import _checksum, is_encrypted_backup
from ..models import Customer, Invoice, InvoiceItem, Service, Staff

SUPPORTED = {
    'api.customer': 'customers',
    'api.service': 'services',
    'api.staff': 'staff',
    'api.invoice': 'invoices',
    'api.invoiceitem': 'items',
}


def _clean_fields(model, fields, skip):
    """Keep only concrete local fields the model still has."""
    allowed = {
        field.name for field in model._meta.concrete_fields
        if not field.primary_key
    }
    cleaned = {}
    for name, value in fields.items():
        if name in skip or name not in allowed:
            continue
        field = model._meta.get_field(name)
        if field.is_relation:
            continue  # relations are wired explicitly below
        if value is not None and hasattr(field, 'get_internal_type'):
            internal = field.get_internal_type()
            if internal == 'DateTimeField' and isinstance(value, str):
                value = parse_datetime(value)
            elif internal == 'DateField' and isinstance(value, str):
                value = parse_date(value)
        cleaned[name] = value
    return cleaned


@transaction.atomic
def import_legacy_backup(business, payload):
    if is_encrypted_backup(payload):
        raise ValueError(
            'فایل پشتیبان رمزگذاری شده است؛ ابتدا در محاسب‌پرو یک خروجی بدون رمز بگیرید.'
        )
    # Light structural validation on purpose: the strict restore
    # validator deserializes every record, while a legacy import must
    # tolerate field drift (e.g. renamed invoice fields) — unknown
    # fields are dropped per record below. The checksum is verified.
    if not isinstance(payload, dict) or payload.get('format') != 'mohaseb-backup-v1':
        raise ValueError('قالب فایل پشتیبان پشتیبانی نمی‌شود؛ یک نسخهٔ جدید تهیه کنید.')
    fixtures = payload.get('fixtures')
    if not isinstance(fixtures, list) or len(fixtures) > 500000:
        raise ValueError('ساختار یا تعداد رکوردهای فایل پشتیبان معتبر نیست.')
    checksum = payload.get('sha256')
    body = {key: value for key, value in payload.items() if key != 'sha256'}
    if not checksum or checksum != _checksum(body):
        raise ValueError('اعتبارسنجی صحت فایل پشتیبان ناموفق بود؛ فایل تغییر کرده یا ناقص است.')
    grouped = {key: [] for key in SUPPORTED.values()}
    for fixture in fixtures:
        label = fixture.get('model')
        if label in SUPPORTED:
            grouped[SUPPORTED[label]].append(fixture)

    counts = {
        'customers_created': 0, 'customers_matched': 0,
        'services_created': 0, 'staff_created': 0, 'staff_matched': 0,
        'invoices_created': 0, 'invoices_skipped': 0, 'items_created': 0,
    }

    customer_map = {}
    for fixture in grouped['customers']:
        fields = fixture.get('fields', {})
        existing = None
        national_id = (fields.get('national_id') or '').strip()
        phone = (fields.get('phone') or '').strip()
        if national_id:
            existing = business.business_customers.filter(national_id=national_id).first()
        if existing is None and phone:
            existing = business.business_customers.filter(phone=phone).first()
        if existing is not None:
            customer_map[fixture['pk']] = existing
            counts['customers_matched'] += 1
            continue
        cleaned = _clean_fields(Customer, fields, skip={'business'})
        cleaned.pop('default_discount_percent', None)
        customer = Customer.objects.create(business=business, **cleaned)
        customer_map[fixture['pk']] = customer
        counts['customers_created'] += 1

    service_map = {}
    for fixture in grouped['services']:
        fields = fixture.get('fields', {})
        title = (fields.get('title') or '').strip()
        existing = business.business_services.filter(title=title).first() if title else None
        if existing is not None:
            service_map[fixture['pk']] = existing
            continue
        cleaned = _clean_fields(Service, fields, skip={'business'})
        service = Service.objects.create(business=business, **cleaned)
        service_map[fixture['pk']] = service
        counts['services_created'] += 1

    staff_map = {}
    for fixture in grouped['staff']:
        fields = fixture.get('fields', {})
        name = (fields.get('name') or '').strip()
        phone = (fields.get('phone') or '').strip()
        existing = Staff.objects.filter(name=name, phone=phone).first() if name else None
        if existing is not None:
            staff_map[fixture['pk']] = existing
            counts['staff_matched'] += 1
            continue
        cleaned = _clean_fields(Staff, fields, skip=set())
        member = Staff.objects.create(**cleaned)
        staff_map[fixture['pk']] = member
        counts['staff_created'] += 1

    invoice_map = {}
    existing_numbers = set(
        business.business_invoices.values_list('invoice_number', flat=True)
    )
    for fixture in grouped['invoices']:
        fields = fixture.get('fields', {})
        number = fields.get('invoice_number') or ''
        if number and number in existing_numbers:
            counts['invoices_skipped'] += 1
            continue
        cleaned = _clean_fields(Invoice, fields, skip={'business', 'customer'})
        cleaned.pop('inventory_posted', None)
        cleaned.pop('sales_journal', None)
        cleaned.pop('cogs_journal', None)
        customer = customer_map.get(fields.get('customer'))
        invoice = Invoice.objects.create(
            business=business, customer=customer, **cleaned,
        )
        invoice_map[fixture['pk']] = invoice
        if number:
            existing_numbers.add(number)
        counts['invoices_created'] += 1

    for fixture in grouped['items']:
        fields = fixture.get('fields', {})
        invoice = invoice_map.get(fields.get('invoice'))
        if invoice is None:
            continue  # item of a skipped invoice
        cleaned = _clean_fields(InvoiceItem, fields, skip={'invoice', 'service', 'product'})
        item = InvoiceItem(
            invoice=invoice,
            service=service_map.get(fields.get('service')),
            **cleaned,
        )
        item.save()
        counts['items_created'] += 1

    return counts
