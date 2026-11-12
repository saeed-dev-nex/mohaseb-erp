"""Accounting core services (ERP phase 1)."""

from decimal import Decimal

from django.db.models import Sum

from ..accounting_chart import STANDARD_CHART, level_for_code


def seed_standard_chart(business):
    """Create the standard chart of accounts for *business*.

    Idempotent by (business, code): existing accounts — including ones
    the user renamed — are left untouched. Returns counts.
    """
    from ..models import Account

    created = 0
    existing = 0
    by_code = {a.code: a for a in Account.objects.filter(business=business)}
    for code, title, parent_code, nature in STANDARD_CHART:
        if code in by_code:
            existing += 1
            continue
        parent = by_code.get(parent_code) if parent_code else None
        account = Account.objects.create(
            business=business,
            code=code,
            title=title,
            parent=parent,
            level=level_for_code(code, parent_code),
            nature=nature,
            is_system=True,
        )
        by_code[code] = account
        created += 1
    return {'created': created, 'existing': existing}


def trial_balance(business, fiscal_year):
    """تراز آزمایشی: per-account debit/credit sums over POSTED entries.

    Returns rows (only accounts with movement) plus grand totals; a
    correct ledger always has total_debit == total_credit.
    """
    from ..models import JournalLine

    aggregates = (
        JournalLine.objects.filter(
            entry__business=business,
            entry__fiscal_year=fiscal_year,
            entry__status='posted',
        )
        .values('account_id', 'account__code', 'account__title', 'account__nature')
        .annotate(total_debit=Sum('debit'), total_credit=Sum('credit'))
        .order_by('account__code')
    )
    rows = []
    total_debit = Decimal(0)
    total_credit = Decimal(0)
    for row in aggregates:
        debit = row['total_debit'] or Decimal(0)
        credit = row['total_credit'] or Decimal(0)
        balance = debit - credit
        rows.append({
            'account': row['account_id'],
            'code': row['account__code'],
            'title': row['account__title'],
            'nature': row['account__nature'],
            'total_debit': debit,
            'total_credit': credit,
            'balance_debit': balance if balance > 0 else Decimal(0),
            'balance_credit': -balance if balance < 0 else Decimal(0),
        })
        total_debit += debit
        total_credit += credit
    return {
        'business': business.id,
        'fiscal_year': fiscal_year.id,
        'rows': rows,
        'total_debit': total_debit,
        'total_credit': total_credit,
        'is_balanced': total_debit == total_credit,
    }


def account_ledger(business, fiscal_year, account):
    """دفتر معین یک حساب: posted lines with a running balance."""
    from ..models import JournalLine

    lines = (
        JournalLine.objects.filter(
            entry__business=business,
            entry__fiscal_year=fiscal_year,
            entry__status='posted',
            account=account,
        )
        .select_related('entry', 'party')
        .order_by('entry__date', 'entry__number', 'id')
    )
    rows = []
    running = Decimal(0)
    for line in lines:
        running += (line.debit or Decimal(0)) - (line.credit or Decimal(0))
        rows.append({
            'entry': line.entry_id,
            'entry_number': line.entry.number,
            'date': line.entry.date,
            'description': line.description or line.entry.description,
            'party_name': line.party.name if line.party else '',
            'debit': line.debit,
            'credit': line.credit,
            'balance': running,
        })
    return rows


def account_by_code(business, code):
    """Fetch one account by code, seeding the standard chart if absent."""
    from ..models import Account

    account = Account.objects.filter(business=business, code=code).first()
    if account is None:
        seed_standard_chart(business)
        account = Account.objects.filter(business=business, code=code).first()
    return account


def create_posted_entry(business, date, description, lines_spec, reference=''):
    """Create a journal entry and post it in one step (auto-journals).

    ``lines_spec`` items: (account_code, debit, credit, party, line_desc).
    The entry lands in the fiscal year containing ``date`` (falling back
    to the business's current year). Raises ValueError when the spec is
    unbalanced or an account code cannot be resolved.
    """
    from django.db import transaction
    from django.db.models import Max
    from django.utils import timezone

    from ..models import JournalEntry, JournalLine

    total_debit = sum(spec[1] for spec in lines_spec)
    total_credit = sum(spec[2] for spec in lines_spec)
    if total_debit != total_credit or total_debit <= 0:
        raise ValueError('سند خودکار تراز نیست.')
    fiscal_year = business.fiscal_years.filter(
        start_date__lte=date, end_date__gte=date,
    ).first() or business.current_fiscal_year
    if fiscal_year is None:
        raise ValueError('سال مالی برای ثبت سند یافت نشد.')
    with transaction.atomic():
        last = (
            JournalEntry.objects.filter(business=business, fiscal_year=fiscal_year)
            .aggregate(value=Max('number'))['value'] or 0
        )
        entry = JournalEntry.objects.create(
            business=business, fiscal_year=fiscal_year, number=last + 1,
            date=date, description=description, reference=reference,
            status='posted', posted_at=timezone.now(),
        )
        for code, debit, credit, party, line_desc in lines_spec:
            account = account_by_code(business, code)
            if account is None:
                raise ValueError(f'حساب {code} در کدینگ یافت نشد.')
            JournalLine.objects.create(
                entry=entry, account=account, party=party,
                description=line_desc, debit=debit, credit=credit,
            )
    return entry
