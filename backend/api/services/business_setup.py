"""Business bootstrapping helpers (ERP phase 0)."""

from datetime import date, timedelta

from ..jalali import gregorian_to_jalali, jalali_to_gregorian


def current_jalali_year(today=None):
    today = today or date.today()
    return gregorian_to_jalali(today.year, today.month, today.day)[0]


def create_default_fiscal_year(business, today=None):
    """Create the current-Jalali-year fiscal year for *business*.

    Dates are stored Gregorian (the app's convention); the year span
    is the Jalali year containing *today*, titled «سال مالی <سال>».
    Returns the FiscalYear, or None if one already exists for the span.
    """
    from ..models import FiscalYear

    jy = current_jalali_year(today)
    start = date(*jalali_to_gregorian(jy, 1, 1))
    next_start = date(*jalali_to_gregorian(jy + 1, 1, 1))
    end = next_start - timedelta(days=1)
    existing = business.fiscal_years.filter(start_date=start).first()
    if existing is not None:
        return existing
    return FiscalYear.objects.create(
        business=business,
        title=f'سال مالی {jy}',
        start_date=start,
        end_date=end,
        is_current=True,
    )


def ensure_default_business():
    """Create the default business on a pre-ERP install (idempotent).

    Used by the 0035 data migration and safe to call again: returns
    the existing first business when one already exists.
    """
    from django.contrib.auth.models import User

    from ..models import Business, BusinessMembership

    business = Business.objects.order_by('id').first()
    if business is not None:
        return business
    business = Business.objects.create(
        name='کسب‌وکار پیش‌فرض',
        template_key='services_repair',
        person_type='legal',
    )
    create_default_fiscal_year(business)
    for user in User.objects.all():
        role = 'owner' if user.is_superuser else ('manager' if user.is_staff else 'operator')
        BusinessMembership.objects.get_or_create(
            user=user, business=business,
            defaults={'role': role, 'is_default': True},
        )
    return business


def seed_template_catalog(business):
    """Seed the business's services/items from its job template.

    Idempotent: a catalog entry is created only when the business has
    no service with the same title, so re-applying never duplicates
    and never touches prices the user has since set. Returns
    {'created': n, 'existing': m}.
    """
    from ..business_templates import template_catalog
    from ..models import Service

    created = 0
    existing = 0
    for entry in template_catalog(business.template_key):
        title = entry['title']
        if Service.objects.filter(business=business, title=title).exists():
            existing += 1
            continue
        Service.objects.create(
            business=business,
            title=title,
            default_main_price=entry.get('default_main_price') or 0,
        )
        created += 1
    return {'created': created, 'existing': existing}
