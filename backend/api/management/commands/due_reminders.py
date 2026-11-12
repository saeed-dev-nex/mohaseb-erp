"""Print (and optionally webhook-POST) the due-date reminders digest.

Designed for schedulers: run it daily from cron or Windows Task Scheduler.

    python manage.py due_reminders [--days 7] [--webhook-url URL]

When no --webhook-url is given, the REMINDER_WEBHOOK_URL environment variable
is used. The webhook receives JSON: {"text": <persian digest>, "digest": {...}}
so any bot or messenger bridge (including the owner's own bot) can forward it.
"""

import json
import os
import urllib.request

from django.core.management.base import BaseCommand

from api.services.reminders import build_reminders, format_digest


class Command(BaseCommand):
    help = 'Show invoices/cheques that are overdue or due soon, optionally POSTing the digest to a webhook.'

    def add_arguments(self, parser):
        parser.add_argument('--days', type=int, default=7, help='Look-ahead window in days (default 7).')
        parser.add_argument('--webhook-url', default='', help='POST the digest JSON to this URL (or set REMINDER_WEBHOOK_URL).')

    def handle(self, *args, **options):
        digest = build_reminders(within_days=options['days'])
        text = format_digest(digest)
        self.stdout.write(text)

        webhook_url = options['webhook_url'] or os.environ.get('REMINDER_WEBHOOK_URL', '')
        if webhook_url:
            payload = json.dumps({'text': text, 'digest': digest}, ensure_ascii=False, default=str).encode('utf-8')
            request = urllib.request.Request(
                webhook_url, data=payload,
                headers={'Content-Type': 'application/json'}, method='POST')
            try:
                with urllib.request.urlopen(request, timeout=10) as response:
                    self.stdout.write(self.style.SUCCESS(f'Webhook delivered (HTTP {response.status}).'))
            except Exception as exc:  # a dead webhook must not break the schedule
                self.stderr.write(self.style.ERROR(f'Webhook delivery failed: {exc}'))
