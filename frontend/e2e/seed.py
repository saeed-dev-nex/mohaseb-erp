"""Seed a throwaway database for the Playwright E2E suite.

Run by playwright.config.ts (webServer) after `migrate`, against the
temporary SQLite file in e2e/.tmp — never against a real database.
Creates the login user plus two invoices: a tall one (print test) and a
paid one (clone test). Test-only credentials, documented in e2e/README.md.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")

import django  # noqa: E402

django.setup()

from django.contrib.auth.models import User  # noqa: E402

from api.models import Customer, Invoice, InvoiceItem  # noqa: E402

E2E_USERNAME = "e2e"
E2E_PASSWORD = "e2e-password"  # test-only, throwaway database

if not User.objects.filter(username=E2E_USERNAME).exists():
    User.objects.create_superuser(
        username=E2E_USERNAME, email="e2e@example.com", password=E2E_PASSWORD
    )

# Tall invoice: six items overflow A5 without the print zoom fix, so the
# print spec can assert the invoice still fits on exactly one page.
tall_customer = Customer.objects.create(name="مشتری چاپ", phone="09120000011")
tall = Invoice.objects.create(
    customer=tall_customer,
    status="pending",
    paper_size="a5",
    vehicle_plate="21 ب 452 - ایران 41",
    total_amount=6 * 100_000,
)
for i in range(6):
    InvoiceItem.objects.create(
        invoice=tall,
        service_title_snapshot=f"خدمت چاپ {i + 1}",
        quantity=1,
        main_price=100_000,
        extra_price=0,
        commission=0,
    )

# Paid invoice used by the clone spec (two items + commission).
clone_customer = Customer.objects.create(name="مشتری نسخه", phone="09120000022")
source = Invoice.objects.create(
    customer=clone_customer,
    status="paid",
    vehicle_plate="77 ب 456 - ایران 11",
    commission_total=20_000,
    total_amount=150_000 + 80_000,
)
InvoiceItem.objects.create(
    invoice=source,
    service_title_snapshot="خلافی",
    quantity=1,
    main_price=150_000,
    extra_price=0,
    commission=0,
)
InvoiceItem.objects.create(
    invoice=source,
    service_title_snapshot="عوارض آزادراهی",
    quantity=1,
    main_price=80_000,
    extra_price=0,
    commission=0,
)

print(f"seeded: tall={tall.invoice_number} clone-source={source.invoice_number}")
# Machine-readable ids for the specs.
Path(__file__).with_name(".tmp").mkdir(exist_ok=True)
(Path(__file__).with_name(".tmp") / "seed.json").write_text(
    '{"tallId": %d, "cloneSourceId": %d}' % (tall.id, source.id),
    encoding="utf-8",
)
