"""Due-date reminders digest (stage 4).

One grouped answer for "what needs chasing": overdue invoices, invoices due
within the next N days, cheques due in the same window, and bounced cheques
that still need follow-up. Used by the dashboard endpoint and by the
``due_reminders`` management command, which can also POST the digest to a
webhook (REMINDER_WEBHOOK_URL) so any messenger/bot can deliver it.
"""

from datetime import date, timedelta

from django.db.models import Sum
from django.utils import timezone

from ..models import Cheque, Invoice, InvoicePayment


def _remaining_by_invoice(invoice_ids):
    rows = (
        InvoicePayment.objects.filter(invoice_id__in=invoice_ids)
        .values('invoice_id')
        .annotate(total=Sum('amount'))
    )
    paid = {row['invoice_id']: int(row['total'] or 0) for row in rows}
    return paid


def _invoice_row(invoice, paid_map, today):
    remaining = max(0, int(invoice.final_amount) - paid_map.get(invoice.id, 0))
    return {
        'id': invoice.id,
        'invoice_number': invoice.invoice_number,
        'customer_name': invoice.customer.name if invoice.customer else '---',
        'customer_id': invoice.customer_id,
        'due_date': invoice.due_date.isoformat() if invoice.due_date else None,
        'days': (invoice.due_date - today).days if invoice.due_date else None,
        'remaining_amount': remaining,
    }


def _cheque_row(cheque, today):
    return {
        'id': cheque.id,
        'cheque_number': cheque.cheque_number,
        'bank_name': cheque.bank_name,
        'customer_name': cheque.customer.name if cheque.customer else '---',
        'customer_id': cheque.customer_id,
        'due_date': cheque.due_date.isoformat() if cheque.due_date else None,
        'days': (cheque.due_date - today).days if cheque.due_date else None,
        'amount': int(cheque.amount),
        'type': cheque.type,
        'status': cheque.status,
    }


def build_reminders(today=None, within_days=7):
    today = today or timezone.localdate()
    horizon = today + timedelta(days=within_days)

    pending = list(
        Invoice.objects.filter(status='pending', due_date__isnull=False)
        .select_related('customer')
        .order_by('due_date')
    )
    paid_map = _remaining_by_invoice([invoice.id for invoice in pending])
    overdue, due_soon = [], []
    for invoice in pending:
        row = _invoice_row(invoice, paid_map, today)
        if invoice.due_date < today:
            overdue.append(row)
        elif invoice.due_date <= horizon:
            due_soon.append(row)

    cheques = list(
        Cheque.objects.filter(status='pending')
        .select_related('customer')
        .order_by('due_date')
    )
    cheques_due = [_cheque_row(cheque, today) for cheque in cheques
                   if cheque.due_date and today <= cheque.due_date <= horizon]
    cheques_overdue = [_cheque_row(cheque, today) for cheque in cheques
                       if cheque.due_date and cheque.due_date < today]
    bounced = [
        _cheque_row(cheque, today)
        for cheque in Cheque.objects.filter(status='bounced').select_related('customer').order_by('due_date')
    ]

    return {
        'today': today.isoformat(),
        'within_days': within_days,
        'overdue_invoices': overdue,
        'due_soon_invoices': due_soon,
        'cheques_due': cheques_due,
        'cheques_overdue': cheques_overdue,
        'bounced_cheques': bounced,
        'totals': {
            'overdue_invoices_count': len(overdue),
            'overdue_invoices_amount': sum(row['remaining_amount'] for row in overdue),
            'due_soon_invoices_count': len(due_soon),
            'due_soon_invoices_amount': sum(row['remaining_amount'] for row in due_soon),
            'cheques_due_count': len(cheques_due),
            'cheques_due_amount': sum(row['amount'] for row in cheques_due),
            'cheques_overdue_count': len(cheques_overdue),
            'bounced_cheques_count': len(bounced),
            'bounced_cheques_amount': sum(row['amount'] for row in bounced),
        },
    }


def format_digest(digest):
    """Plain-text Persian digest for logs, cron mail or a messenger bot."""
    totals = digest['totals']
    lines = [f"یادآوری سررسید محاسب پرو — {digest['today']}"]
    if totals['overdue_invoices_count']:
        lines.append(f"فاکتور سررسیدگذشته: {totals['overdue_invoices_count']} فقره، مانده {totals['overdue_invoices_amount']:,} تومان")
        for row in digest['overdue_invoices'][:10]:
            lines.append(f"  - {row['invoice_number']} · {row['customer_name']} · مانده {row['remaining_amount']:,} · {abs(row['days'])} روز گذشته")
    if totals['due_soon_invoices_count']:
        lines.append(f"فاکتور نزدیک سررسید ({digest['within_days']} روز آینده): {totals['due_soon_invoices_count']} فقره، مانده {totals['due_soon_invoices_amount']:,} تومان")
        for row in digest['due_soon_invoices'][:10]:
            lines.append(f"  - {row['invoice_number']} · {row['customer_name']} · مانده {row['remaining_amount']:,} · {row['days']} روز مانده")
    if totals['cheques_due_count'] or totals['cheques_overdue_count']:
        lines.append(f"چک در جریان: {totals['cheques_due_count']} فقره نزدیک سررسید ({totals['cheques_due_amount']:,} تومان)، {totals['cheques_overdue_count']} فقره گذشته از سررسید")
        for row in digest['cheques_due'][:10]:
            lines.append(f"  - چک {row['cheque_number']} · {row['bank_name']} · {row['amount']:,} · {row['days']} روز مانده")
    if totals['bounced_cheques_count']:
        lines.append(f"چک برگشتی نیازمند پیگیری: {totals['bounced_cheques_count']} فقره، جمع {totals['bounced_cheques_amount']:,} تومان")
    if len(lines) == 1:
        lines.append('موردی برای یادآوری نیست. ✅')
    return '\n'.join(lines)
