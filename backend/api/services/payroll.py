"""Payroll engine (ERP phase 3).

Computation rules (Iranian payroll, kept explicit and configurable):
- Monthly components pro-rate by days worked over 30 (daily divisor).
- The hourly wage is the daily wage divided by 7.33; overtime pays the
  hourly wage times the overtime factor (default 1.4).
- Insurance base = base pay + housing + food + overtime (child
  allowance is exempt). Employee share defaults to 7%, employer 23%.
- Taxable income = gross − child allowance; tax follows the business's
  editable monthly brackets (defaults: قانون بودجهٔ ۱۴۰۴).
"""

from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction

from ..jalali import jalali_to_gregorian
from .accounting import create_posted_entry

SALARY_EXPENSE_ACCOUNT = '5201'  # هزینه حقوق و دستمزد
SALARY_PAYABLE_ACCOUNT = '2106'  # حقوق پرداختنی
TAX_PAYABLE_ACCOUNT = '2105'     # مالیات پرداختنی
INSURANCE_PAYABLE_ACCOUNT = '2102'  # سایر حساب‌های پرداختنی

DAILY_DIVISOR = Decimal(30)
HOURLY_DIVISOR = Decimal('7.33')


def money(value):
    return Decimal(value).quantize(Decimal('1'), rounding=ROUND_HALF_UP)


def get_payroll_settings(business):
    from ..models import PayrollSettings

    settings, _ = PayrollSettings.objects.get_or_create(business=business)
    return settings


def progressive_tax(taxable, brackets):
    """مالیات پلکانی: brackets = [[upper_limit_or_None, rate_percent], …]"""
    taxable = Decimal(taxable)
    if taxable <= 0:
        return Decimal(0)
    tax = Decimal(0)
    previous_limit = Decimal(0)
    for raw_limit, raw_rate in brackets or []:
        rate = Decimal(str(raw_rate)) / Decimal(100)
        if raw_limit is None:
            portion = taxable - previous_limit
            if portion > 0:
                tax += portion * rate
            break
        limit = Decimal(str(raw_limit))
        portion = min(taxable, limit) - previous_limit
        if portion > 0:
            tax += portion * rate
        if taxable <= limit:
            break
        previous_limit = limit
    return money(tax)


def compute_payslip(profile, settings, days_worked, overtime_hours,
                    other_additions=0, other_deductions=0):
    """Compute every component of one payslip (returns a dict)."""
    days = Decimal(days_worked)
    ratio = days / DAILY_DIVISOR
    base_pay = money(profile.base_salary * ratio)
    housing = money(profile.housing_allowance * ratio)
    food = money(profile.food_allowance * ratio)
    child = money(
        profile.child_allowance_each * profile.children_count * ratio
    )
    daily_wage = profile.base_salary / DAILY_DIVISOR
    hourly_wage = daily_wage / HOURLY_DIVISOR
    overtime_pay = money(
        hourly_wage * Decimal(overtime_hours) * settings.overtime_factor
    )
    gross = (
        base_pay + housing + food + child + overtime_pay
        + Decimal(other_additions)
    )
    if profile.is_insured:
        insurance_base = base_pay + housing + food + overtime_pay
        insurance_employee = money(
            insurance_base * settings.insurance_employee_rate / Decimal(100)
        )
        insurance_employer = money(
            insurance_base * settings.insurance_employer_rate / Decimal(100)
        )
    else:
        insurance_base = Decimal(0)
        insurance_employee = Decimal(0)
        insurance_employer = Decimal(0)
    taxable_income = gross - child
    tax = progressive_tax(taxable_income, settings.tax_brackets)
    net = gross - insurance_employee - tax - Decimal(other_deductions)
    return {
        'base_pay': base_pay, 'housing': housing, 'food': food,
        'child': child, 'overtime_pay': overtime_pay, 'gross': gross,
        'insurance_base': insurance_base,
        'insurance_employee': insurance_employee,
        'insurance_employer': insurance_employer,
        'taxable_income': taxable_income, 'tax': tax, 'net': net,
    }


def recalculate_payslip(payslip):
    settings = get_payroll_settings(payslip.period.business)
    values = compute_payslip(
        payslip.profile, settings, payslip.days_worked,
        payslip.overtime_hours, payslip.other_additions,
        payslip.other_deductions,
    )
    for field, value in values.items():
        setattr(payslip, field, value)
    payslip.save()
    return payslip


@transaction.atomic
def generate_payslips(period, user=None):
    """Create (or refresh) a draft payslip for each active profile."""
    from ..models import Payslip

    settings = get_payroll_settings(period.business)
    created = 0
    for profile in period.business.employment_profiles.filter(is_active=True):
        payslip, was_created = Payslip.objects.get_or_create(
            period=period, profile=profile,
            # Full-month default: monthly components are defined per
            # 30-day month, so a 31-day month still defaults to 30.
            defaults={'days_worked': min(period.days_in_month, 30)},
        )
        recalculate_payslip(payslip)
        created += 1 if was_created else 0
    return {'payslips': period.payslips.count(), 'created': created}


@transaction.atomic
def finalize_period(period, user=None):
    """نهایی‌کردن دوره: یک سند حسابداری تجمیعی و قفل دوره."""
    import datetime

    if period.status == 'finalized':
        raise ValueError('این دوره قبلاً نهایی شده است.')
    if period.payslips.count() == 0:
        raise ValueError('دوره هیچ فیشی ندارد؛ ابتدا فیش‌ها را تولید کنید.')
    for payslip in period.payslips.all():
        recalculate_payslip(payslip)
    slips = list(period.payslips.all())
    gross_total = sum((s.gross for s in slips), Decimal(0))
    employer_total = sum((s.insurance_employer for s in slips), Decimal(0))
    net_total = sum((s.net for s in slips), Decimal(0))
    tax_total = sum((s.tax for s in slips), Decimal(0))
    insurance_total = sum(
        (s.insurance_employee + s.insurance_employer for s in slips), Decimal(0),
    )
    other_deductions_total = sum((s.other_deductions for s in slips), Decimal(0))
    # Journal balance identity: net + tax + insurance (employee +
    # employer) + other deductions == gross + employer insurance,
    # because net already subtracts the employee share, the tax and
    # the other deductions from gross.
    lines = [
        (SALARY_EXPENSE_ACCOUNT, gross_total, Decimal(0), None, 'هزینه حقوق و مزایا'),
    ]
    if employer_total > 0:
        lines.append((SALARY_EXPENSE_ACCOUNT, employer_total, Decimal(0), None, 'بیمه سهم کارفرما'))
    if net_total > 0:
        lines.append((SALARY_PAYABLE_ACCOUNT, Decimal(0), net_total, None, 'خالص حقوق پرداختنی'))
    if tax_total > 0:
        lines.append((TAX_PAYABLE_ACCOUNT, Decimal(0), tax_total, None, 'مالیات حقوق پرداختنی'))
    if insurance_total > 0:
        lines.append((INSURANCE_PAYABLE_ACCOUNT, Decimal(0), insurance_total, None, 'حق بیمه پرداختنی'))
    if other_deductions_total > 0:
        # کسورات دیگر (مساعده، وام و…) قبلاً به کارمند پرداخت یا برای او
        # هزینه شده‌اند و در «سایر حساب‌های دریافتنی» نشسته‌اند؛ سند
        # نهایی آن‌ها را تسویه می‌کند تا سند تراز بماند.
        lines.append(('1104', Decimal(0), other_deductions_total, None, 'تسویه کسورات کارکنان (مساعده و سایر)'))
    last_day = period.days_in_month
    gy, gm, gd = jalali_to_gregorian(period.year, period.month, last_day)
    entry = create_posted_entry(
        period.business, datetime.date(gy, gm, gd),
        f'هزینه حقوق {period.year}/{period.month:02d}',
        lines, reference=f'PAY-{period.year}{period.month:02d}',
    )
    period.journal_entry = entry
    period.status = 'finalized'
    period.save(update_fields=['journal_entry', 'status', 'updated_at'])
    return period


@transaction.atomic
def unfinalize_period(period):
    """برگرداندن دوره به پیش‌نویس و حذف سند خودکار آن."""
    if period.status != 'finalized':
        raise ValueError('این دوره نهایی نشده است.')
    if period.journal_entry_id:
        period.journal_entry.delete()
    period.journal_entry = None
    period.status = 'draft'
    period.save(update_fields=['journal_entry', 'status', 'updated_at'])
    return period
