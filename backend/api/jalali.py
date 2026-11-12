"""Jalali (Shamsi) calendar helpers — pure arithmetic, no dependencies.

Mirrors the conversions in ``frontend/src/utils/persian.ts`` so the API
and the UI agree on month boundaries: in this app a "month" is always a
Jalali month (e.g. آبان ۱۴۰۵ runs Oct 23 – Nov 21), never a Gregorian
one. The dashboard's monthly chart and the report's monthly series both
bucket by these helpers.

Algorithm: the standard jalaali arithmetic (33-year cycles) — the same
one the frontend implements; the two are sweep-tested against each
other over 2024–2028.
"""

from datetime import date

JALALI_MONTH_NAMES = [
    'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
    'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
]

_BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210,
           1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178]


def _div(a, b):
    # JS-style integer division (truncate toward zero).
    return int(a / b)


def _mod(a, b):
    return a - _div(a, b) * b


def _jal_cal(jy):
    """Return (leap, gy, march): leap==0 means jy is a leap year, and
    Farvardin 1 of jy falls on March `march` of Gregorian year `gy`."""
    if jy < _BREAKS[0] or jy >= _BREAKS[-1]:
        raise ValueError(f'Jalali year out of supported range: {jy}')
    gy = jy + 621
    leap_j = -14
    jp = _BREAKS[0]
    jump = 0
    for br in _BREAKS[1:]:
        jump = br - jp
        if jy < br:
            break
        leap_j += _div(jump, 33) * 8 + _div(_mod(jump, 33), 4)
        jp = br
    n = jy - jp
    leap_j += _div(n, 33) * 8 + _div(_mod(n, 33) + 3, 4)
    if _mod(jump, 33) == 4 and jump - n == 4:
        leap_j += 1
    leap_g = _div(gy, 4) - _div((_div(gy, 100) + 1) * 3, 4) - 150
    march = 20 + leap_j - leap_g
    if jump - n < 6:
        n = n - jump + _div(jump + 4, 33) * 33
    leap = _mod(_mod(n + 1, 33) - 1, 4)
    if leap == -1:
        leap = 4
    return leap, gy, march


def _g2d(gy, gm, gd):
    d = (_div((gy + _div(gm - 8, 6) + 100100) * 1461, 4)
         + _div(153 * _mod(gm + 9, 12) + 2, 5)
         + gd - 34840408)
    return d - _div(_div(gy + 100100 + _div(gm - 8, 6), 100) * 3, 4) + 752


def _d2g(jdn):
    j = 4 * jdn + 139361631
    j += _div(_div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908
    i = _div(_mod(j, 1461), 4) * 5 + 308
    gd = _div(_mod(i, 153), 5) + 1
    gm = _mod(_div(i, 153), 12) + 1
    gy = _div(j, 1461) - 100100 + _div(8 - gm, 6)
    return gy, gm, gd


def _j2d(jy, jm, jd):
    _, gy, march = _jal_cal(jy)
    return _g2d(gy, 3, march) + (jm - 1) * 31 - _div(jm, 7) * (jm - 7) + jd - 1


def _d2j(jdn):
    gy = _d2g(jdn)[0]
    jy = gy - 621
    leap, _, march = _jal_cal(jy)
    k = jdn - _g2d(gy, 3, march)
    if k >= 0:
        if k <= 185:
            return jy, 1 + _div(k, 31), _mod(k, 31) + 1
        k -= 186
    else:
        jy -= 1
        k += 179
        if leap == 1:
            k += 1
    return jy, 7 + _div(k, 30), _mod(k, 30) + 1


def gregorian_to_jalali(gy, gm, gd):
    """(year, month, day) Gregorian → (jy, jm, jd) Jalali."""
    return _d2j(_g2d(gy, gm, gd))


def jalali_to_gregorian(jy, jm, jd):
    """(jy, jm, jd) Jalali → (year, month, day) Gregorian."""
    return _d2g(_j2d(jy, jm, jd))


def jalali_month_key(d):
    """'1405-08' bucket key for a Gregorian ``date`` (sorts correctly)."""
    jy, jm, _ = gregorian_to_jalali(d.year, d.month, d.day)
    return f'{jy:04d}-{jm:02d}'


def jalali_month_label(jy, jm):
    """'آبان ۱۴۰۵' — month name + year in Persian digits."""
    fa_year = ''.join('۰۱۲۳۴۵۶۷۸۹'[int(c)] for c in str(jy))
    return f'{JALALI_MONTH_NAMES[jm - 1]} {fa_year}'


def jalali_month_bounds(jy, jm):
    """(start, next_start) Gregorian dates bounding Jalali month jy/jm."""
    gy, gm, gd = jalali_to_gregorian(jy, jm, 1)
    if jm == 12:
        njy, njm = jy + 1, 1
    else:
        njy, njm = jy, jm + 1
    ngy, ngm, ngd = jalali_to_gregorian(njy, njm, 1)
    return date(gy, gm, gd), date(ngy, ngm, ngd)
