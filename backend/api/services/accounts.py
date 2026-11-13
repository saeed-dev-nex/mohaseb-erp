"""Account services: registration codes, one-time codes, security profile."""

import hashlib
import secrets

from django.contrib.auth.models import User
from django.utils import timezone

from ..emailer import send_one_time_code
from ..models import OneTimeCode, RegistrationCode, UserSecurityProfile

CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
OTP_TTL_MINUTES = 10
OTP_MAX_ATTEMPTS = 5


def hash_secret(value):
    return hashlib.sha256(str(value).encode('utf-8')).hexdigest()


# ---------------------------------------------------------------------------
# Registration (license) codes
# ---------------------------------------------------------------------------

def normalize_registration_code(raw):
    return ''.join(str(raw or '').split()).replace('-', '').upper()


def generate_registration_code():
    raw = ''.join(secrets.choice(CODE_ALPHABET) for _ in range(16))
    return '-'.join(raw[index:index + 4] for index in range(0, 16, 4))


def create_registration_codes(created_by, count, note='', valid_days=None):
    """Create ``count`` codes; returns the plain codes (shown once)."""
    plain_codes = []
    expires_at = None
    if valid_days:
        expires_at = timezone.now() + timezone.timedelta(days=valid_days)
    for _ in range(count):
        plain = generate_registration_code()
        RegistrationCode.objects.create(
            code_hash=hash_secret(normalize_registration_code(plain)),
            code_hint=plain[-4:],
            note=note or '',
            created_by=created_by,
            expires_at=expires_at,
        )
        plain_codes.append(plain)
    return plain_codes


def find_registration_code(raw):
    if not raw:
        return None
    return RegistrationCode.objects.filter(
        code_hash=hash_secret(normalize_registration_code(raw)),
    ).first()


# ---------------------------------------------------------------------------
# Security profile + password age
# ---------------------------------------------------------------------------

def get_security_profile(user):
    profile, _ = UserSecurityProfile.objects.get_or_create(
        user=user,
        defaults={'password_changed_at': user.date_joined or timezone.now()},
    )
    return profile


def password_age_days(user):
    profile = get_security_profile(user)
    return (timezone.now() - profile.password_changed_at).days


def mark_password_changed(user):
    profile = get_security_profile(user)
    profile.password_changed_at = timezone.now()
    profile.save(update_fields=['password_changed_at'])


def revoke_all_sessions(user):
    """Blacklist every outstanding refresh token of the user."""
    from rest_framework_simplejwt.token_blacklist.models import OutstandingToken

    from rest_framework_simplejwt.tokens import RefreshToken

    for outstanding in OutstandingToken.objects.filter(user=user):
        try:
            RefreshToken(outstanding.token).blacklist()
        except Exception:
            pass  # Already blacklisted or malformed: nothing to revoke.


# ---------------------------------------------------------------------------
# One-time codes (email verification, password reset, login OTP)
# ---------------------------------------------------------------------------

def issue_one_time_code(user, purpose):
    """Create + email a fresh code, invalidating previous ones."""
    OneTimeCode.objects.filter(
        user=user, purpose=purpose, consumed_at__isnull=True,
    ).update(consumed_at=timezone.now())
    code = f'{secrets.randbelow(1_000_000):06d}'
    record = OneTimeCode.objects.create(
        user=user,
        purpose=purpose,
        code_hash=hash_secret(code),
        sent_to=user.email or '',
        expires_at=timezone.now() + timezone.timedelta(minutes=OTP_TTL_MINUTES),
    )
    if user.email:
        send_one_time_code(user.email, code, purpose)
    return record


def verify_one_time_code(user, purpose, raw_code):
    """Check a code; consumes it on success, counts failed attempts."""
    record = (
        OneTimeCode.objects.filter(
            user=user, purpose=purpose, consumed_at__isnull=True,
        )
        .order_by('-id')
        .first()
    )
    if record is None:
        return False
    if record.expires_at <= timezone.now() or record.attempts >= OTP_MAX_ATTEMPTS:
        return False
    if secrets.compare_digest(record.code_hash, hash_secret(str(raw_code or '').strip())):
        record.consumed_at = timezone.now()
        record.save(update_fields=['consumed_at'])
        return True
    record.attempts += 1
    record.save(update_fields=['attempts'])
    return False


def find_user_for_recovery(identifier):
    """Resolve a username-or-email identifier to an active user, or None.

    Username match wins; an email must match exactly one active
    account (legacy data may share emails across accounts).
    """
    identifier = str(identifier or '').strip()
    if not identifier:
        return None
    user = User.objects.filter(username__iexact=identifier, is_active=True).first()
    if user is not None:
        return user
    matches = list(User.objects.filter(email__iexact=identifier, is_active=True)[:2])
    if len(matches) == 1:
        return matches[0]
    return None
