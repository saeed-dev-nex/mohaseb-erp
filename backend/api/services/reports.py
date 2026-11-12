"""Financial report + Excel export logic, extracted from the invoice view.

Behaviour is locked by api.tests.test_reports: the numbers, labels and sheet
layout are exactly what the views produced before, but payment and item
totals now come from grouped aggregate queries instead of Python loops over
prefetched relations for every invoice and every status.
"""

import io
from decimal import Decimal

from django.db.models import F, Sum
from django.utils import timezone

from ..jalali import gregorian_to_jalali, jalali_month_label
from ..models import Expense, Invoice, InvoiceItem, InvoicePayment
from .money import payment_totals, safe_spreadsheet_cell

METHOD_LABELS = dict(InvoicePayment.METHOD_CHOICES)


def _filter_invoices(date_from='', date_to='', status_filter='', customer_search=''):
    qs = Invoice.objects.select_related('customer', 'created_by', 'paid_by').prefetch_related(
        'payments__created_by', 'items__service', 'edit_requests').all()
    if date_from:
        qs = qs.filter(date__date__gte=date_from)
    if date_to:
        qs = qs.filter(date__date__lte=date_to)
    if status_filter:
        qs = qs.filter(status=status_filter)
    if customer_search:
        qs = qs.filter(customer__name__icontains=customer_search)
    return qs.order_by('-date')


def _filter_expenses(date_from='', date_to=''):
    qs = Expense.objects.select_related('category').all()
    if date_from:
        qs = qs.filter(date__gte=date_from)
    if date_to:
        qs = qs.filter(date__lte=date_to)
    return qs


def _paid_amounts(invoice_ids):
    """{invoice_id: total paid} from one grouped query."""
    rows = (
        InvoicePayment.objects.filter(invoice_id__in=invoice_ids)
        .values('invoice_id')
        .annotate(total=Sum('amount'))
    )
    return {row['invoice_id']: Decimal(row['total'] or 0) for row in rows}


def _paid_amount_with_legacy_fallback(invoice, paid_amounts):
    return payment_totals(invoice.final_amount, invoice.status, paid_amounts.get(invoice.id, 0))[0]


def build_report_data(date_from='', date_to='', status_filter='', customer_search=''):
    """Return (report_dict_without_invoice_rows, invoice_rows)."""
    invoice_rows = list(_filter_invoices(date_from, date_to, status_filter, customer_search))
    invoice_ids = [invoice.id for invoice in invoice_rows]
    paid_amounts = _paid_amounts(invoice_ids)

    payment_methods = {}
    for row in (
        InvoicePayment.objects.filter(invoice_id__in=invoice_ids)
        .values('method')
        .annotate(total=Sum('amount'))
    ):
        label = METHOD_LABELS.get(row['method'], row['method'])
        payment_methods[label] = payment_methods.get(label, 0) + int(row['total'] or 0)

    service_totals = {}
    item_rows = (
        InvoiceItem.objects.filter(invoice_id__in=invoice_ids)
        .values('service_title_snapshot', 'service__title')
        .annotate(total=Sum((F('main_price') + F('extra_price')) * F('quantity')))
    )
    for row in item_rows:
        title = row['service_title_snapshot'] or row['service__title'] or 'سایر'
        service_totals[title] = service_totals.get(title, 0) + int(row['total'] or 0)

    total_revenue = total_commission = pending_amount = invoice_amount = 0
    by_month, customer_totals = {}, {}
    by_status = {key: {'label': label, 'count': 0, 'amount': 0} for key, label in Invoice.STATUS_CHOICES}
    for invoice in invoice_rows:
        final = int(invoice.final_amount)
        paid_total = _paid_amount_with_legacy_fallback(invoice, paid_amounts)
        total_revenue += paid_total
        if invoice.status == 'paid' or invoice.commission_paid:
            total_commission += int(invoice.commission_total)
        if invoice.status == 'pending':
            pending_amount += payment_totals(invoice.final_amount, invoice.status, paid_amounts.get(invoice.id, 0))[1]
        if invoice.status != 'cancelled':
            invoice_amount += final

        # Monthly buckets are JALALI months (the app's calendar), keyed by
        # their Jalali 'YYYY-MM' so sorting stays chronological.
        if invoice.date:
            local_date = timezone.localtime(invoice.date).date()
            jy, jm, _ = gregorian_to_jalali(local_date.year, local_date.month, local_date.day)
            month = f'{jy:04d}-{jm:02d}'
            month_label = jalali_month_label(jy, jm)
        else:
            month, month_label = 'نامشخص', 'نامشخص'
        bucket = by_month.setdefault(month, {'count': 0, 'amount': 0, 'received': 0, 'label': month_label})
        bucket['count'] += 1
        bucket['amount'] += final
        bucket['received'] += paid_total

        if invoice.customer_id:
            customer = customer_totals.setdefault(
                invoice.customer_id, {'name': invoice.customer.name, 'count': 0, 'amount': 0})
            customer['count'] += 1
            customer['amount'] += final

        status_bucket = by_status.setdefault(invoice.status, {'label': invoice.get_status_display(), 'count': 0, 'amount': 0})
        status_bucket['count'] += 1
        status_bucket['amount'] += payment_totals(invoice.final_amount, invoice.status, paid_amounts.get(invoice.id, 0))[1] if invoice.status == 'pending' else final

    for bucket in by_status.values():
        bucket['amount'] = int(bucket['amount'])

    expenses = _filter_expenses(date_from, date_to)
    expense_total = expenses.aggregate(total=Sum('amount'))['total'] or 0
    expense_categories = list(
        expenses.values('category__name').annotate(total=Sum('amount')).order_by('-total'))

    data = {
        'total_revenue': int(total_revenue),
        'total_commission': int(total_commission),
        'pending_amount': int(pending_amount),
        'total_count': len(invoice_rows),
        'invoice_amount': invoice_amount,
        'expense_total': int(expense_total),
        'net_profit': int(total_commission - expense_total),
        'by_status': by_status,
        'monthly': [{'month': month, **values, 'received': int(values['received'])} for month, values in sorted(by_month.items())],
        'top_customers': sorted(customer_totals.values(), key=lambda item: item['amount'], reverse=True)[:10],
        'top_services': [
            {'name': name, 'amount': amount}
            for name, amount in sorted(service_totals.items(), key=lambda row: row[1], reverse=True)[:10]
        ],
        'payment_methods': [
            {'name': name, 'amount': amount}
            for name, amount in sorted(payment_methods.items(), key=lambda row: row[1], reverse=True)
        ],
        'expense_categories': [
            {'name': row['category__name'] or 'بدون دسته', 'amount': int(row['total'] or 0)}
            for row in expense_categories
        ],
    }
    return data, invoice_rows


def build_excel_bytes(date_from='', date_to='', status_filter='', customer_search=''):
    """A real .xlsx workbook (openpyxl) with the historical sheet layout."""
    from openpyxl import Workbook

    invoice_rows = list(_filter_invoices(date_from, date_to, status_filter, customer_search))
    expense_rows = list(_filter_expenses(date_from, date_to).order_by('-date'))
    invoice_ids = [invoice.id for invoice in invoice_rows]
    paid_sums = _paid_amounts(invoice_ids)
    paid_amounts = {
        invoice.id: _paid_amount_with_legacy_fallback(invoice, paid_sums)
        for invoice in invoice_rows
    }
    received = sum(paid_amounts.values())
    commission = sum(int(inv.commission_total) for inv in invoice_rows if inv.status == 'paid' or inv.commission_paid)
    expense_total = sum(int(item.amount) for item in expense_rows)

    payments_by_invoice = {}
    payments = (
        InvoicePayment.objects.filter(invoice_id__in=invoice_ids)
        .select_related('invoice__customer', 'created_by')
        .order_by('-paid_at', '-id')
    )
    for payment in payments:
        payments_by_invoice.setdefault(payment.invoice_id, []).append(payment)

    sheets = [
        ('خلاصه', [
            ['شاخص', 'مقدار'], ['از تاریخ', date_from or 'همه'], ['تا تاریخ', date_to or 'امروز'],
            ['تعداد فاکتور', len(invoice_rows)], ['مبلغ دریافت‌شده', int(received)],
            ['کارمزد فاکتورهای پرداخت‌شده', commission],
            ['مبلغ هزینه‌ها', expense_total], ['سود خالص', commission - expense_total],
        ]),
        ('فاکتورها', [['شماره فاکتور', 'مشتری', 'تاریخ', 'وضعیت', 'مبلغ کل', 'کارمزد', 'مبلغ نهایی', 'مبلغ پرداخت‌شده', 'مانده', 'پرداخت‌کننده', 'صادرکننده']] + [
            [inv.invoice_number, inv.customer.name if inv.customer else '', timezone.localtime(inv.date).strftime('%Y-%m-%d') if inv.date else '',
             inv.get_status_display(), int(inv.total_amount), int(inv.commission_total), int(inv.final_amount),
              int(paid_amounts[inv.id]), int(payment_totals(inv.final_amount, inv.status, paid_sums.get(inv.id, 0))[1]),
             inv.paid_by.get_full_name() or inv.paid_by.username if inv.paid_by else '',
             inv.created_by.get_full_name() or inv.created_by.username if inv.created_by else '']
            for inv in invoice_rows
        ]),
        ('هزینه‌ها', [['عنوان', 'دسته', 'تاریخ', 'مبلغ', 'توضیحات']] + [
            [item.title, item.category.name if item.category else 'بدون دسته', item.date.isoformat(),
             int(item.amount), item.description or '']
            for item in expense_rows
        ]),
        ('پرداخت‌ها', [['شماره فاکتور', 'مشتری', 'تاریخ پرداخت', 'روش پرداخت', 'مبلغ', 'ثبت‌کننده', 'توضیحات']] + [
            [payment.invoice.invoice_number,
             payment.invoice.customer.name if payment.invoice.customer else '',
              timezone.localtime(payment.paid_at).strftime('%Y-%m-%d %H:%M') if payment.paid_at else '',
             payment.get_method_display(), int(payment.amount),
             payment.created_by.get_full_name() or payment.created_by.username if payment.created_by else '',
             payment.note]
            for inv in invoice_rows for payment in payments_by_invoice.get(inv.id, [])
        ]),
    ]

    workbook = Workbook()
    for index, (title, rows) in enumerate(sheets):
        worksheet = workbook.active if index == 0 else workbook.create_sheet()
        assert worksheet is not None
        worksheet.title = title
        worksheet.sheet_view.rightToLeft = True
        for row in rows:
            worksheet.append([safe_spreadsheet_cell(value) for value in row])
        worksheet.freeze_panes = 'A2'

    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()
