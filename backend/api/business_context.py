"""Resolve the caller's current Business (ERP phase 0).

The frontend keeps the current business id and sends it as the
``X-Business-Id`` header. Resolution never trusts the header alone:
the business must exist, be active, and the caller must be a member
(a superuser may resolve any business). When the header is absent or
invalid the request simply has no business context — existing
single-business behaviour is unchanged, which keeps the whole
mohaseb-pro base working untouched until a UI opts into switching.
"""

from .models import Business


def resolve_business(request):
    """Return the Business for this request, or None."""
    headers = getattr(request, 'headers', None)
    raw = headers.get('X-Business-Id') if headers is not None else None
    if not raw:
        return None
    try:
        business_id = int(raw)
    except (TypeError, ValueError):
        return None
    business = Business.objects.filter(id=business_id, is_active=True).first()
    if business is None:
        return None
    user = getattr(request, 'user', None)
    if user is None or not getattr(user, 'is_authenticated', False):
        return None
    if user.is_superuser:
        return business
    if business.memberships.filter(user=user).exists():
        return business
    return None


def user_businesses(user):
    """Businesses *user* may work in (all of them for a superuser)."""
    qs = Business.objects.filter(is_active=True)
    if user is not None and getattr(user, 'is_superuser', False):
        return qs
    return qs.filter(memberships__user=user).distinct()
