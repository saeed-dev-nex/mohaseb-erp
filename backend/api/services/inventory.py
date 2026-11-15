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


def warehouse_stock(product, warehouse):
    """Current quantity of *product* in one warehouse."""
    from ..models import StockMovement

    total = Decimal(0)
    for movement in StockMovement.objects.filter(product=product, warehouse=warehouse):
        total += movement.signed_quantity
    return total


def get_inventory_settings(business):
    from ..models import InventorySettings

    settings_obj, _ = InventorySettings.objects.get_or_create(business=business)
    return settings_obj


def ensure_stock_available(business, product, warehouse, quantity):
    """Negative-stock guard (phase 2.5) — a no-op unless the business
    turned «جلوگیری از موجودی منفی» on in its inventory settings."""
    if not get_inventory_settings(business).block_negative_stock:
        return
    available = warehouse_stock(product, warehouse)
    if quantity > available:
        raise ValueError(
            f'موجودی کالای «{product.name}» در انبار «{warehouse.name}» کافی نیست '
            f'(موجودی: {available}، مورد نیاز: {quantity}).'
        )


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
    """ثبت نهایی خرید: ورود به انبار + میانگین موزون + سند خودکار.

    Landed costs (هزینه‌های جانبی) are spread over the lines by value
    and folded into each movement's unit cost, so the weighted average
    — and with it COGS — carries the real shelf cost. The journal
    books the grand total (goods + extras) as inventory against the
    supplier payable.
    """
    from ..models import StockMovement

    if purchase.status == 'posted':
        raise ValueError('این فاکتور خرید قبلاً ثبت شده است.')
    warehouse = purchase.warehouse or get_default_warehouse(purchase.business)
    lines = list(purchase.lines.select_related('product'))
    goods_total = purchase.total
    extra = purchase.extra_costs or Decimal(0)
    allocations = _allocate_extra_costs(lines, goods_total, extra)
    for line, allocated in zip(lines, allocations):
        line_cost_total = line.total + allocated
        landed_unit = (
            (line_cost_total / line.quantity).quantize(Decimal('1'))
            if line.quantity > 0 else line.unit_price
        )
        line.landed_unit_cost = landed_unit
        line.save(update_fields=['landed_unit_cost'])
        StockMovement.objects.create(
            business=purchase.business, product=line.product,
            warehouse=warehouse, kind='in_purchase',
            quantity=line.quantity, unit_cost=landed_unit,
            batch_no=line.batch_no or '', expiry_date=line.expiry_date,
            source_type='purchase', source_id=purchase.id,
            date=purchase.date, created_by=user,
            note=f'خرید شماره {purchase.number}',
        )
        recompute_average_cost(line.product)
    total = purchase.grand_total
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


def _allocate_extra_costs(lines, goods_total, extra):
    """Spread *extra* over *lines* proportionally to line totals.

    Whole-Toman rounding; the last line absorbs the remainder so the
    allocations always sum exactly to *extra*.
    """
    if extra <= 0 or goods_total <= 0 or not lines:
        return [Decimal(0)] * len(lines)
    allocations = []
    remaining = extra
    for index, line in enumerate(lines):
        if index == len(lines) - 1:
            allocations.append(remaining)
        else:
            share = (extra * line.total / goods_total).quantize(Decimal('1'))
            allocations.append(share)
            remaining -= share
    return allocations


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
    purchase.lines.update(landed_unit_cost=0)
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
    """ثبت انبار و سند فروش فاکتور.

    Revenue is recognised for EVERY line — product and service alike:
    a service business's sales must reach the books exactly like a
    shop's (before this, service-only invoices never journaled and a
    service trade's accounting stayed empty). Stock movements and COGS
    remain product-only, valued at each product's weighted-average
    cost at posting time.
    """
    from ..models import StockMovement

    if invoice.inventory_posted:
        raise ValueError('انبار و سند این فاکتور قبلاً ثبت شده است.')
    if invoice.business_id is None:
        raise ValueError('فاکتور به کسب‌وکاری متصل نیست.')
    all_items = list(invoice.items.all())
    if not all_items:
        raise ValueError('این فاکتور سطری ندارد.')
    items = [item for item in all_items if item.product_id]
    warehouse = get_default_warehouse(invoice.business)
    # Negative-stock guard: check the summed need per product before
    # writing any movement (no-op unless the business enabled it).
    needed = {}
    for item in items:
        needed[item.product_id] = needed.get(item.product_id, Decimal(0)) + Decimal(item.quantity)
    for product_id, quantity in needed.items():
        ensure_stock_available(
            invoice.business,
            next(item.product for item in items if item.product_id == product_id),
            warehouse, quantity,
        )
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
        cogs += Decimal(item.quantity) * product.average_cost
    # Revenue covers the whole invoice: product lines plus service
    # lines (an item without a product is a service/adhoc line).
    revenue = sum((Decimal(item.line_total) for item in all_items), Decimal(0))
    business = invoice.business
    if revenue > 0:
        has_products = bool(items)
        has_services = len(all_items) > len(items)
        if has_products and has_services:
            sale_label = 'فروش کالا و خدمات'
        elif has_services:
            sale_label = 'فروش خدمات'
        else:
            sale_label = 'فروش کالا'
        invoice.sales_journal = create_posted_entry(
            business, sale_date,
            f'{sale_label} — فاکتور {invoice.invoice_number or invoice.id}',
            [
                (RECEIVABLES_ACCOUNT, revenue, Decimal(0), invoice.customer, 'مطالبات از مشتری'),
                (SALES_REVENUE_ACCOUNT, Decimal(0), revenue, None, f'درآمد {sale_label}'),
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


@transaction.atomic
def post_transfer(transfer, user=None):
    """ثبت حوالهٔ انتقال: خروج از انبار مبدأ و ورود به مقصد، هم‌بها.

    Transfers move quantity, not value: both legs carry the product's
    current weighted-average cost, so the business's total stock value
    is unchanged and average costs do not move.
    """
    from ..models import StockMovement

    if transfer.status == 'posted':
        raise ValueError('این حواله قبلاً ثبت شده است.')
    if transfer.from_warehouse_id == transfer.to_warehouse_id:
        raise ValueError('انبار مبدأ و مقصد نمی‌توانند یکی باشند.')
    lines = list(transfer.lines.select_related('product'))
    if not lines:
        raise ValueError('حواله سطری ندارد.')
    for line in lines:
        ensure_stock_available(
            transfer.business, line.product, transfer.from_warehouse, line.quantity,
        )
    for line in lines:
        product = line.product
        StockMovement.objects.create(
            business=transfer.business, product=product,
            warehouse=transfer.from_warehouse, kind='out_transfer',
            quantity=line.quantity, unit_cost=product.average_cost,
            source_type='transfer', source_id=transfer.id,
            date=transfer.date, created_by=user,
            note=f'حواله انتقال {transfer.number} — خروج',
        )
        StockMovement.objects.create(
            business=transfer.business, product=product,
            warehouse=transfer.to_warehouse, kind='in_transfer',
            quantity=line.quantity, unit_cost=product.average_cost,
            source_type='transfer', source_id=transfer.id,
            date=transfer.date, created_by=user,
            note=f'حواله انتقال {transfer.number} — ورود',
        )
    transfer.status = 'posted'
    transfer.save(update_fields=['status', 'updated_at'])
    return transfer


@transaction.atomic
def unpost_transfer(transfer):
    from ..models import StockMovement

    if transfer.status != 'posted':
        raise ValueError('این حواله ثبت نشده است.')
    StockMovement.objects.filter(
        source_type='transfer', source_id=transfer.id,
    ).delete()
    transfer.status = 'draft'
    transfer.save(update_fields=['status', 'updated_at'])
    return transfer


@transaction.atomic
def apply_stock_count(count, user=None):
    """اعمال انبارگردانی: برای هر مغایرت، گردش اصلاحی خودکار.

    Lines never counted (counted_qty is null) are left untouched —
    a partial count only adjusts what was actually counted.
    """
    from ..models import StockMovement

    if count.status == 'applied':
        raise ValueError('این انبارگردانی قبلاً اعمال شده است.')
    adjusted = 0
    for line in count.lines.select_related('product'):
        if line.counted_qty is None:
            continue
        variance = line.counted_qty - line.system_qty
        if variance == 0:
            continue
        if variance < 0:
            ensure_stock_available(
                count.business, line.product, count.warehouse, -variance,
            )
        StockMovement.objects.create(
            business=count.business, product=line.product,
            warehouse=count.warehouse,
            kind='in_adjust' if variance > 0 else 'out_adjust',
            quantity=abs(variance), unit_cost=line.product.average_cost,
            source_type='stock_count', source_id=count.id,
            date=count.date, created_by=user,
            note=f'انبارگردانی شماره {count.number}',
        )
        adjusted += 1
    count.status = 'applied'
    count.save(update_fields=['status', 'updated_at'])
    return adjusted
