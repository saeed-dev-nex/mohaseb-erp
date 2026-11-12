"""Jalali conversion helpers — the API and the UI must agree on months."""

from datetime import date

from django.test import SimpleTestCase

from api.jalali import (
    gregorian_to_jalali,
    jalali_month_bounds,
    jalali_month_key,
    jalali_month_label,
    jalali_to_gregorian,
)


class JalaliConversionTests(SimpleTestCase):
    def test_known_pairs(self):
        # 1 Aban 1405 is Oct 23, 2026 (the boundary the reports got wrong).
        self.assertEqual(jalali_to_gregorian(1405, 8, 1), (2026, 10, 23))
        self.assertEqual(gregorian_to_jalali(2026, 10, 23), (1405, 8, 1))
        self.assertEqual(gregorian_to_jalali(2026, 11, 1), (1405, 8, 10))
        self.assertEqual(gregorian_to_jalali(2027, 1, 1), (1405, 10, 11))
        # Nowruz 1405 = Mar 21, 2026.
        self.assertEqual(jalali_to_gregorian(1405, 1, 1), (2026, 3, 21))
        self.assertEqual(gregorian_to_jalali(2026, 3, 21), (1405, 1, 1))

    def test_round_trip(self):
        for gy, gm, gd in [(2024, 2, 29), (2025, 3, 20), (2026, 10, 31), (2028, 12, 31)]:
            jy, jm, jd = gregorian_to_jalali(gy, gm, gd)
            self.assertEqual(jalali_to_gregorian(jy, jm, jd), (gy, gm, gd))

    def test_month_bounds(self):
        # Aban 1405: Oct 23 – Nov 21 inclusive.
        self.assertEqual(
            jalali_month_bounds(1405, 8), (date(2026, 10, 23), date(2026, 11, 22)))
        # Esfand of leap year 1403 has 30 days: Feb 19 – Mar 20, 2025.
        self.assertEqual(
            jalali_month_bounds(1403, 12), (date(2025, 2, 19), date(2025, 3, 21)))
        # Esfand of non-leap 1405 has 29 days.
        start, next_start = jalali_month_bounds(1405, 12)
        self.assertEqual((next_start - start).days, 29)

    def test_key_and_label(self):
        self.assertEqual(jalali_month_key(date(2026, 11, 1)), '1405-08')
        self.assertEqual(jalali_month_label(1405, 8), 'آبان ۱۴۰۵')
        self.assertEqual(jalali_month_label(1405, 1), 'فروردین ۱۴۰۵')
