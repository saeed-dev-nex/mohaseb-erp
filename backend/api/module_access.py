"""Granular per-module access (stage 6).

The app historically knew three roles: operator, manager (is_staff) and
admin (is_superuser). This module layers per-module control on top without
changing what any role could do before:

* superuser -> every module, always (a row can never lock an admin out);
* no UserModuleAccess row -> the role ceiling, exactly the pre-stage-6
  behaviour;
* a row -> the ceiling intersected with the row's enabled modules (a row
  can only restrict, never grant beyond the role).
"""

from django.core.exceptions import ObjectDoesNotExist

# Modules every authenticated user could reach before stage 6
# (plain IsAuthenticated endpoints).
RESOURCE_MODULES = (
    'invoices', 'customers', 'services', 'expenses', 'cheques',
    'reports', 'chat', 'staff',
)
# Account administration is distinct from Django's is_staff flag.
MANAGER_MODULES = ('settings',)
ADMIN_MODULES = ('users', 'backup')

ALL_MODULES = RESOURCE_MODULES + MANAGER_MODULES + ADMIN_MODULES


def effective_modules(user):
    """Return the set of module keys *user* may access right now."""
    if user is None or not getattr(user, 'is_authenticated', False):
        return set()
    if user.is_superuser:
        return set(ALL_MODULES)
    ceiling = set(RESOURCE_MODULES)
    if user.is_staff:
        ceiling |= set(MANAGER_MODULES)
    try:
        access = user.module_access
    except ObjectDoesNotExist:
        access = None
    if access is None:
        return ceiling
    enabled = {name for name in ALL_MODULES if getattr(access, name, False)}
    return ceiling & enabled
