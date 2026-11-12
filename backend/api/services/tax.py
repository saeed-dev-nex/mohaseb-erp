"""Tax reporting + fixed-asset depreciation services (ERP phase 4)."""

import datetime
from decimal import Decimal

from django.db import transaction

from ..jalali import gregorian_to_jalali, jalali_month_bounds, jalali_to_gregorian
from .accounting import create_posted_entry
from .payroll import money

DEPRECIATION_EXPENSE_ACCOUNT = '5205'  # هزینه استهلاک
ACCUMULATED_ACCOUNT = '1202'           # استهلاک انباشته


def get_tax_settings(business):
    from ..models import TaxSettings

    settings, _ = TaxSettings.objects.get_or_create(business=business)
    return settings


def quarter_bounds(year, season):
    """(start, end) Gregorian dates of a Jalali quarter (end exclusive)."""
    first_month = (season - 1) * 3 + 1
    start, _ = jalali_month_bounds(year, first_month)
    last_month = first_month + 2
    _, end = jalali_month_bounds(year, last_month)
    return start, end


def invoice_vat(invoice):
    """Output VAT of one sales invoice: stored tax % over its subtotal."""
    return money(invoice.total_amount * invoice.tax / Decimal(100))


def vat_report(business, year, season):
    """گزارش دوره‌ای ارزش افزوده: فروش/خرید و ماندهٔ قابل پرداخت."""
    from ..models import Invoice, PurchaseInvoice

    start, end = quarter_bounds(year, season)
    invoices = Invoice.objects.filter(
        business=business, date__date__gte=start, date__date__lt=end,
    ).exclude(status='cancelled')
    sales_base = Decimal(0)
    output_vat = Decimal(0)
    for invoice in invoices:
        sales_base += invoice.total_amount
        output_vat += invoice_vat(invoice)
    purchases = PurchaseInvoice.objects.filter(
        business=business, status='posted', date__gte=start, date__lt=end,
    ).prefetch_related('lines')
    purchases_base = Decimal(0)
    input_vat = Decimal(0)
    for purchase in purchases:
        purchases_base += purchase.total
        input_vat += purchase.vat_amount
    return {
        'year': year, 'season': season,
        'sales_count': invoices.count(), 'sales_base': sales_base,
        'output_vat': output_vat,
        'purchases_count': purchases.count(), 'purchases_base': purchases_base,
        'input_vat': input_vat,
        'payable': output_vat - input_vat,
    }


def seasonal_report(business, year, season):
    """معاملات فصلی (مادهٔ ۱۶۹): تجمیع فروش و خرید به تفکیک طرف حساب."""
    from ..models import Invoice, PurchaseInvoice

    start, end = quarter_bounds(year, season)
    rows = {}

    def bucket(party, side):
        key = (party.id if party else 0, side)
        if key not in rows:
            rows[key] = {
                'party': party.id if party else None,
                'party_name': party.name if party else 'بدون طرف حساب',
                'national_id': party.national_id if party else '',
                'side': side, 'count': 0,
                'amount': Decimal(0), 'vat': Decimal(0),
            }
        return rows[key]

    invoices = (
        Invoice.objects.filter(
            business=business, date__date__gte=start, date__date__lt=end,
        )
        .exclude(status='cancelled')
        .select_related('customer')
    )
    for invoice in invoices:
        row = bucket(invoice.customer, 'sale')
        row['count'] += 1
        row['amount'] += (
            invoice.total_amount + invoice_vat(invoice)
            - invoice.discount + invoice.commission_total
        )
        row['vat'] += invoice_vat(invoice)
    purchases = (
        PurchaseInvoice.objects.filter(
            business=business, status='posted', date__gte=start, date__lt=end,
        )
        .select_related('supplier')
        .prefetch_related('lines')
    )
    for purchase in purchases:
        row = bucket(purchase.supplier, 'purchase')
        row['count'] += 1
        row['amount'] += purchase.total
        row['vat'] += purchase.vat_amount
    return sorted(rows.values(), key=lambda r: (r['side'], r['party_name']))


def _month_index(year, month):
    return year * 12 + month


@transaction.atomic
def run_depreciation(business, year, month, user=None):
    """Book one month of straight-line depreciation for eligible assets.

    Depreciation starts the month after purchase; each run advances
    every eligible asset by exactly one month (capped at its useful
    life and depreciable base), so missed months are caught up one
    run at a time and a month can never be booked twice for an asset.
    """
    from ..models import DepreciationLine, DepreciationRun, FixedAsset

    if DepreciationRun.objects.filter(business=business, year=year, month=month).exists():
        raise ValueError('استهلاک این ماه قبلاً ثبت شده است.')
    target = _month_index(year, month)
    run = DepreciationRun.objects.create(
        business=business, year=year, month=month, created_by=user,
    )
    total = Decimal(0)
    for asset in FixedAsset.objects.filter(business=business, is_active=True):
        jy, jm, _ = gregorian_to_jalali(
            asset.purchase_date.year, asset.purchase_date.month, asset.purchase_date.day,
        )
        next_month = _month_index(jy, jm) + 1 + asset.depreciated_months
        if next_month > target:
            continue
        if asset.depreciated_months >= asset.life_months or asset.is_fully_depreciated:
            continue
        remaining = asset.depreciable_base - asset.accumulated_depreciation
        amount = min(asset.monthly_depreciation, remaining)
        if amount <= 0:
            continue
        DepreciationLine.objects.create(run=run, asset=asset, amount=amount)
        asset.accumulated_depreciation += amount
        asset.depreciated_months += 1
        asset.save(update_fields=['accumulated_depreciation', 'depreciated_months', 'updated_at'])
        total += amount
    run.total_amount = total
    if total > 0:
        gy, gm, gd = jalali_to_gregorian(year, month, 28)
        run.journal_entry = create_posted_entry(
            business, datetime.date(gy, gm, gd),
            f'استهلاک دارایی‌ها — {year}/{month:02d}',
            [
                (DEPRECIATION_EXPENSE_ACCOUNT, total, Decimal(0), None, 'هزینه استهلاک دوره'),
                (ACCUMULATED_ACCOUNT, Decimal(0), total, None, 'استهلاک انباشته'),
            ],
            reference=f'DEP-{year}{month:02d}',
        )
    run.save(update_fields=['total_amount', 'journal_entry'])
    return run


@transaction.atomic
def delete_depreciation_run(run):
    """Reverse a run: restore asset counters and drop its journal."""
    for line in run.lines.select_related('asset'):
        asset = line.asset
        asset.accumulated_depreciation -= line.amount
        asset.depreciated_months = max(0, asset.depreciated_months - 1)
        asset.save(update_fields=['accumulated_depreciation', 'depreciated_months', 'updated_at'])
    if run.journal_entry_id:
        run.journal_entry.delete()
    run.delete()
