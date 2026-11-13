"""Password complexity policy for end-user accounts.

Applied wherever an end user sets a password: self-service
registration, password reset, and in-app password change. (The
first-run setup wizard keeps its own ≥8 rule for the platform owner.)
"""

import re

from rest_framework.exceptions import ValidationError

MIN_LENGTH = 8
SPECIAL_CHARS = "!@#$%^&*()-_=+[]{};:'\",.<>/?\\|`~"

# Days after which the UI starts warning that the password is old.
PASSWORD_MAX_AGE_DAYS = 90


def password_failures(password):
    """Return the list of unmet rules (Persian messages)."""
    failures = []
    password = password or ''
    if len(password) < MIN_LENGTH:
        failures.append(f'رمز عبور باید دست‌کم {MIN_LENGTH} نویسه باشد.')
    if not re.search(r'[a-z]', password):
        failures.append('رمز عبور باید دست‌کم یک حرف کوچک انگلیسی داشته باشد.')
    if not re.search(r'[A-Z]', password):
        failures.append('رمز عبور باید دست‌کم یک حرف بزرگ انگلیسی داشته باشد.')
    if not re.search(r'\d', password):
        failures.append('رمز عبور باید دست‌کم یک عدد داشته باشد.')
    if not any(char in SPECIAL_CHARS for char in password):
        failures.append('رمز عبور باید دست‌کم یک کاراکتر خاص (مثل !@#$) داشته باشد.')
    return failures


def validate_password_complexity(password):
    failures = password_failures(password)
    if failures:
        raise ValidationError({'password': failures})
