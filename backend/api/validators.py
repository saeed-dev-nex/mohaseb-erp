"""Iranian identifier validation (stage 4 — first step toward سامانه مؤدیان).

- کد ملی (natural persons, 10 digits): full checksum validation.
- شناسه ملی (legal entities, 11 digits): format validation. Its checksum is
  not enforced yet, deliberately: applying a half-remembered legal-entity
  algorithm would reject real customers, so only shape is checked until the
  official algorithm is verified against issued identifiers.
Persian/Arabic digits and separators are normalized before checking.
"""

from rest_framework import serializers

_DIGIT_TRANSLATION = str.maketrans('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789')


def normalize_digits(value):
    return str(value).translate(_DIGIT_TRANSLATION).replace(' ', '').replace('-', '').strip()


def is_valid_national_code(code):
    """True when a 10-digit کد ملی passes the official checksum."""
    if len(code) != 10 or not code.isdigit():
        return False
    if len(set(code)) == 1:  # 1111111111 passes the raw checksum but is not real
        return False
    total = sum(int(code[i]) * (10 - i) for i in range(9))
    remainder = total % 11
    control = int(code[9])
    return control == remainder if remainder < 2 else control == 11 - remainder


def validate_customer_identifier(value):
    """Validate Customer.national_id: accepts کد ملی (10) or شناسه ملی (11).

    Returns the normalized (Latin digits) identifier; raises a Persian
    DRF ValidationError otherwise. Empty values are returned untouched —
    serializers normalize them to None before calling this.
    """
    if value in (None, ''):
        return value
    normalized = normalize_digits(value)
    if len(normalized) == 10:
        if not is_valid_national_code(normalized):
            raise serializers.ValidationError('کد ملی واردشده معتبر نیست (رقم کنترلی درست نیست).')
        return normalized
    if len(normalized) == 11:
        if not normalized.isdigit() or len(set(normalized)) == 1:
            raise serializers.ValidationError('شناسه ملی باید ۱۱ رقم باشد.')
        return normalized
    raise serializers.ValidationError('کد ملی (۱۰ رقم) یا شناسه ملی (۱۱ رقم) را کامل وارد کنید.')


def validate_national_code_field(value):
    """For fields that must be a natural person's کد ملی when provided."""
    if value in (None, ''):
        return value
    normalized = normalize_digits(value)
    if not is_valid_national_code(normalized):
        raise serializers.ValidationError('کد ملی واردشده معتبر نیست (رقم کنترلی درست نیست).')
    return normalized


def validate_tax_id(value):
    """Business tax identifier (شناسه مالیاتی): 11 digits when provided."""
    if value in (None, ''):
        return value
    normalized = normalize_digits(value)
    if len(normalized) != 11 or not normalized.isdigit():
        raise serializers.ValidationError('شناسه مالیاتی باید ۱۱ رقم باشد.')
    return normalized


# First path components (after the drive/root) that must never receive
# copied customer documents: operating-system locations. Writing uploaded
# files there could overwrite or pollute system files.
_WINDOWS_SYSTEM_DIRS = {
    'windows', 'program files', 'program files (x86)', 'programdata',
    'system volume information', '$recycle.bin', 'recovery',
}
_POSIX_SYSTEM_DIRS = {
    'etc', 'usr', 'bin', 'sbin', 'boot', 'sys', 'proc', 'dev',
    'lib', 'lib64', 'root',
}


def validate_customer_documents_path(value):
    """Validate BusinessProfile.customer_documents_path.

    The path is an admin-chosen folder on the server that receives copies
    of uploaded customer documents. It stays free-form (any data volume is
    fine), but it must be absolute, must not be a filesystem root, and
    must not point into an operating-system directory. Both Windows and
    POSIX shapes are checked, because the value is interpreted by the
    server OS, not by the machine validating the request.
    """
    import ntpath
    import posixpath
    import re

    if value in (None, ''):
        return value
    value = str(value).strip()
    if not value:
        return value
    # Pick the path style by shape first: ntpath.isabs() also accepts
    # POSIX-looking '/usr/...' paths, which would misroute the checks.
    if re.match(r'^[A-Za-z]:', value) or value.startswith('\\\\'):
        is_windows = True
    elif value.startswith('/'):
        is_windows = False
    elif ntpath.isabs(value):
        is_windows = True  # rooted on the current drive, e.g. '\docs'
    else:
        is_windows = False
    if is_windows:
        absolute = ntpath.isabs(value)
    else:
        absolute = posixpath.isabs(value)
    if not absolute:
        raise serializers.ValidationError(
            'مسیر ذخیره‌سازی مدارک باید یک مسیر کامل باشد (مثل D:\\MohasebDocuments).'
        )
    if is_windows:
        normalized = ntpath.normpath(value)
        parts = [p for p in normalized.replace('/', '\\').split('\\') if p]
        # parts[0] is the drive ('D:') or UNC server name.
        rest = [p.lower() for p in parts[1:]]
        if not rest or rest[0] in _WINDOWS_SYSTEM_DIRS:
            raise serializers.ValidationError(
                'مسیر ذخیره‌سازی مدارک نمی‌تواند پوشهٔ سیستمی یا ریشهٔ درایو باشد.'
            )
    else:
        normalized = posixpath.normpath(value)
        parts = [p for p in normalized.split('/') if p]
        if not parts or parts[0].lower() in _POSIX_SYSTEM_DIRS:
            raise serializers.ValidationError(
                'مسیر ذخیره‌سازی مدارک نمی‌تواند پوشهٔ سیستمی یا ریشهٔ فایل‌سیستم باشد.'
            )
    return value
