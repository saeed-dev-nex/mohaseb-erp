"""Shared decimal calculations; no database access in financial arithmetic."""

from decimal import Decimal


MAX_INVOICE_AMOUNT = Decimal('999999999999999')
MAX_ITEM_AMOUNT = Decimal('999999999999')


def final_amount(total, tax=0, discount=0, commission=0):
    total = Decimal(total or 0)
    return total + total * Decimal(tax or 0) / Decimal(100) - Decimal(discount or 0) + Decimal(commission or 0)


ROUNDING_STEP = 10000
ROUNDING_THRESHOLD = 5000


def compute_rounding_adjustment(base, target=None):
    """Signed adjustment that rounds an invoice final amount.

    With an explicit ``target`` the adjustment lands the final exactly
    on it. Without one, the final rounds to the nearest 10,000 Toman:
    a remainder under 5,000 rounds down, 5,000 or more rounds up.
    Works on the whole-Toman value the API exposes, so the stored
    adjustment is always an integer number of Tomans.
    """
    whole = int(Decimal(base or 0))
    if target is not None:
        return Decimal(int(target) - whole)
    remainder = whole % ROUNDING_STEP
    if remainder == 0:
        return Decimal(0)
    if remainder >= ROUNDING_THRESHOLD:
        return Decimal(ROUNDING_STEP - remainder)
    return Decimal(-remainder)


def payment_totals(final, status, recorded):
    """Preserve legacy settlement: paid invoices count at least their final total."""
    final, recorded = Decimal(final), Decimal(recorded)
    paid = max(recorded, final) if status == 'paid' else recorded
    return paid, max(Decimal(0), final - paid)


def invoice_payment_totals(invoice):
    # RelatedManager.all() consumes Django's prefetch cache; aggregate() does not.
    recorded = sum((Decimal(payment.amount) for payment in invoice.payments.all()), Decimal(0))
    return payment_totals(invoice.final_amount, invoice.status, recorded)


def office_card_fee(total, source, threshold):
    total, threshold = Decimal(total), Decimal(threshold or 0)
    return total // Decimal(100) if source == 'office' and threshold > 0 and total > threshold else Decimal(0)


def safe_spreadsheet_cell(value):
    """Keep untrusted text literal in both spreadsheet and CSV consumers."""
    if isinstance(value, str) and (value.lstrip().startswith(('=', '+', '-', '@')) or value.startswith(('\t', '\r', '\n'))):
        return "'" + value
    return value
