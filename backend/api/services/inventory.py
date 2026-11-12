"""Inventory + purchasing services (ERP phase 2).

Stock lives in StockMovement rows; Product.average_cost follows the
weighted average of purchase-ins and is recomputed from the surviving
purchase movements whenever a purchase is unposted, so reversals stay
consistent. Posting is always paired with a balanced auto-journal
(phase 1's create_posted_entry), and unposting removes both sides.
"""

from decimal import Decimal

from django.db import transaction

from .accounting import create_posted_entry

INVENTORY_ACCOUNT = '1105'   # موجودی کالا
PAYABLES_ACCOUNT = '2101'    # حساب‌های پرداختنی تجاری
RECEIVABLES_ACCOUNT = '1103'  # حساب‌های دریافتنی تجاری
SALES_REVENUE_ACCOUNT = '4101'  # درآمد فروش کالا
COGS_ACCOUNT = '5101'        # بهای تمام‌شده کالای فروش‌رفته


def get_default_warehouse(business):
    from ..models import Warehouse

    warehouse, _ = Warehouse.objects.get_or_create(
        business=business, is_default=True,
        defaults={'name': 'انبار اصلی'},
    )
    return warehouse


def current_stock(product):
    from ..models import StockMovement

    total = Decimal(0)
    for movement in StockMovement.objects.filter(product=product):
        total += movement.signed_quantity
    return total


def recompute_average_cost(product):
    """Weighted average over the product's surviving purchase-ins."""
    from ..models import StockMovement

    ins = StockMovement.objects.filter(product=product, kind='in_purchase')
    total_qty = Decimal(0)
    total_cost = Decimal(0)
    for movement in ins:
        total_qty += movement.quantity
        total_cost += movement.quantity * movement.unit_cost
    product.average_cost = (total_cost / total_qty) if total_qty > 0 else Decimal(0)
    product.save(update_fields=['average_cost', 'updated_at'])
    return product.average_cost


@transaction.atomic
def post_purchase(purchase, user=None):
    """ثبت نهایی خرید: ورود به انبار + میانگین موزون + سند خودکار."""
    from ..models import StockMovement

    if purchase.status == 'posted':
        raise ValueError('این فاکتور خرید قبلاً ثبت شده است.')
    warehouse = get_default_warehouse(purchase.business)
    for line in purchase.lines.select_related('product'):
        StockMovement.objects.create(
            business=purchase.business, product=line.product,
            warehouse=warehouse, kind='in_purchase',
            quantity=line.quantity, unit_cost=line.unit_price,
            source_type='purchase', source_id=purchase.id,
            date=purchase.date, created_by=user,
            note=f'خرید شماره {purchase.number}',
        )
        recompute_average_cost(line.product)
    total = purchase.total
    entry = create_posted_entry(
        purchase.business, purchase.date,
        f'خرید کالا — فاکتور خرید {purchase.number} از {purchase.supplier.name}',
        [
            (INVENTORY_ACCOUNT, total, Decimal(0), None, 'ورود کالا به انبار'),
            (PAYABLES_ACCOUNT, Decimal(0), total, purchase.supplier, 'بدهی به تأمین‌کننده'),
        ],
        reference=f'PUR-{purchase.number}',
    )
    purchase.journal_entry = entry
    purchase.status = 'posted'
    purchase.save(update_fields=['journal_entry', 'status', 'updated_at'])
    return purchase


@transaction.atomic
def unpost_purchase(purchase):
    """برگرداندن خرید به پیش‌نویس: حذف گردش‌ها و سند، بازحساب میانگین."""
    from ..models import StockMovement

    if purchase.status != 'posted':
        raise ValueError('این فاکتور خرید ثبت نشده است.')
    products = list(purchase.lines.values_list('product_id', flat=True))
    StockMovement.objects.filter(
        source_type='purchase', source_id=purchase.id,
    ).delete()
    if purchase.journal_entry_id:
        purchase.journal_entry.delete()
    purchase.journal_entry = None
    purchase.status = 'draft'
    purchase.save(update_fields=['journal_entry', 'status', 'updated_at'])
    from ..models import Product

    for product in Product.objects.filter(id__in=products):
        recompute_average_cost(product)
    return purchase


@transaction.atomic
def post_sale(invoice, user=None):
    """ثبت انبار و سند برای سطرهای کالایی فاکتور فروش.

    Revenue is recognised for the product lines only (service lines
    keep their existing operational flow), and COGS is valued at each
    product's weighted-average cost at posting time.
    """
    from ..models import StockMovement

    if invoice.inventory_posted:
        raise ValueError('انبار و سند این فاکتور قبلاً ثبت شده است.')
    if invoice.business_id is None:
        raise ValueError('فاکتور به کسب‌وکاری متصل نیست.')
    items = [item for item in invoice.items.all() if item.product_id]
    if not items:
        raise ValueError('این فاکتور سطر کالایی ندارد.')
    warehouse = get_default_warehouse(invoice.business)
    sale_date = invoice.date.date() if hasattr(invoice.date, 'date') else invoice.date
    revenue = Decimal(0)
    cogs = Decimal(0)
    for item in items:
        product = item.product
        StockMovement.objects.create(
            business=invoice.business, product=product,
            warehouse=warehouse, kind='out_sale',
            quantity=Decimal(item.quantity), unit_cost=product.average_cost,
            source_type='invoice', source_id=invoice.id,
            date=sale_date, created_by=user,
            note=f'فروش — فاکتور {invoice.invoice_number or invoice.id}',
        )
        revenue += Decimal(item.line_total)
        cogs += Decimal(item.quantity) * product.average_cost
    business = invoice.business
    invoice.sales_journal = create_posted_entry(
        business, sale_date,
        f'فروش کالا — فاکتور {invoice.invoice_number or invoice.id}',
        [
            (RECEIVABLES_ACCOUNT, revenue, Decimal(0), invoice.customer, 'مطالبات از مشتری'),
            (SALES_REVENUE_ACCOUNT, Decimal(0), revenue, None, 'درآمد فروش کالا'),
        ],
        reference=f'INV-{invoice.invoice_number or invoice.id}',
    )
    if cogs > 0:
        invoice.cogs_journal = create_posted_entry(
            business, sale_date,
            f'بهای تمام‌شده — فاکتور {invoice.invoice_number or invoice.id}',
            [
                (COGS_ACCOUNT, cogs, Decimal(0), None, 'بهای تمام‌شده کالای فروش‌رفته'),
                (INVENTORY_ACCOUNT, Decimal(0), cogs, None, 'خروج کالا از انبار'),
            ],
            reference=f'INV-{invoice.invoice_number or invoice.id}',
        )
    invoice.inventory_posted = True
    invoice.save(update_fields=['sales_journal', 'cogs_journal', 'inventory_posted'])
    return invoice


@transaction.atomic
def unpost_sale(invoice):
    """حذف گردش‌ها و اسناد خودکار فاکتور فروش."""
    from ..models import StockMovement

    if not invoice.inventory_posted:
        raise ValueError('انبار و سند این فاکتور ثبت نشده است.')
    StockMovement.objects.filter(
        source_type='invoice', source_id=invoice.id,
    ).delete()
    for journal in (invoice.sales_journal, invoice.cogs_journal):
        if journal is not None:
            journal.delete()
    invoice.sales_journal = None
    invoice.cogs_journal = None
    invoice.inventory_posted = False
    invoice.save(update_fields=['sales_journal', 'cogs_journal', 'inventory_posted'])
    return invoice
