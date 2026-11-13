"""Outgoing mail for one-time codes.

Delivery goes through Django's mail settings (SMTP when EMAIL_HOST
is configured via the environment, otherwise the console backend,
which prints messages to the server log — the flow stays testable on
a LAN install with no mail server).
"""

import logging

from django.conf import settings
from django.core.mail import send_mail

logger = logging.getLogger(__name__)

PURPOSE_TEXT = {
    'verify_email': ('تأیید ایمیل حساب محاسب ERP', 'برای فعال‌سازی حساب‌تان'),
    'password_reset': ('بازیابی رمز عبور محاسب ERP', 'برای بازیابی رمز عبور حساب‌تان'),
    'login_otp': ('کد ورود محاسب ERP', 'برای ورود به حساب‌تان'),
}


def email_configured():
    backend = getattr(settings, 'EMAIL_BACKEND', '') or ''
    return 'smtp' in backend


def send_one_time_code(email, code, purpose):
    """Send a one-time code; returns True when handed to the backend."""
    subject, intro = PURPOSE_TEXT.get(purpose, ('کد تأیید محاسب ERP', ''))
    body = (
        f'کد تأیید شما {intro}:\n\n'
        f'    {code}\n\n'
        'این کد ۱۰ دقیقه اعتبار دارد. اگر این درخواست از طرف شما نبوده، '
        'این ایمیل را نادیده بگیرید.'
    )
    try:
        send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, [email],
                  fail_silently=False)
        return True
    except Exception:
        logger.exception('Sending one-time code email failed')
        return False
