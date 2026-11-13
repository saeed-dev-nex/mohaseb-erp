"""Built-in image CAPTCHA (SVG), no external service needed.

A challenge is a short code rendered as a noisy SVG. The expected
answer lives in the Django cache (hashed), keyed by a random id, for
five minutes, and is consumed by the first verification attempt —
right or wrong — so a challenge can never be replayed or brute-forced
one guess at a time.

Used progressively on login (after repeated failures) and on the
public registration / password-recovery forms.
"""

import hashlib
import random
import secrets

from django.core.cache import cache

ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
CODE_LENGTH = 4
TTL_SECONDS = 300
_CACHE_PREFIX = 'captcha:'


def _hash(answer):
    return hashlib.sha256(f'captcha:{answer}'.encode('utf-8')).hexdigest()


def _render_svg(code):
    rng = random.Random(secrets.randbits(64))
    glyphs = []
    for index, char in enumerate(code):
        x = 18 + index * 26
        y = 38 + rng.randint(-4, 4)
        rotate = rng.randint(-18, 18)
        fill = rng.choice(['#e2e8f0', '#93c5fd', '#fca5a5', '#86efac', '#fcd34d'])
        glyphs.append(
            f'<text x="{x}" y="{y}" font-size="28" font-family="monospace" '
            f'font-weight="bold" fill="{fill}" '
            f'transform="rotate({rotate} {x} {y})">{char}</text>'
        )
    noise = []
    for _ in range(5):
        x1, y1 = rng.randint(0, 130), rng.randint(0, 50)
        x2, y2 = rng.randint(0, 130), rng.randint(0, 50)
        noise.append(
            f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" '
            f'stroke="#475569" stroke-width="1" opacity="0.6"/>'
        )
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="130" height="50" '
        'viewBox="0 0 130 50">'
        '<rect width="130" height="50" rx="8" fill="#1e293b"/>'
        + ''.join(noise) + ''.join(glyphs) + '</svg>'
    )
    import base64

    return 'data:image/svg+xml;base64,' + base64.b64encode(svg.encode('utf-8')).decode('ascii')


def new_challenge():
    """Create a challenge; returns (challenge_id, image_data_uri)."""
    code = ''.join(secrets.choice(ALPHABET) for _ in range(CODE_LENGTH))
    challenge_id = secrets.token_hex(16)
    cache.set(_CACHE_PREFIX + challenge_id, _hash(code.upper()), TTL_SECONDS)
    return challenge_id, _render_svg(code)


def verify_challenge(challenge_id, answer):
    """One-shot check: the challenge is consumed by any attempt."""
    if not challenge_id or answer is None:
        return False
    key = _CACHE_PREFIX + str(challenge_id)
    expected = cache.get(key)
    cache.delete(key)
    if expected is None:
        return False
    return secrets.compare_digest(expected, _hash(str(answer).strip().upper()))
