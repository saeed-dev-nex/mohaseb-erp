/**
 * Money helpers shared by the invoice form and the details page.
 * Mirrors backend `api/services/money.py` — the server re-derives every
 * value, these exist so the UI can preview results live.
 */

/**
 * Signed adjustment that rounds a final amount. With an explicit target
 * the final lands exactly on it; without one it rounds to the nearest
 * 10,000 Toman: a remainder under 5,000 rounds down, 5,000 or more up.
 */
export function computeRoundingAdjustment(
  base: number,
  target?: number | null,
): number {
  const whole = Math.trunc(Number(base) || 0);
  if (target != null && Number(target) > 0) {
    return Math.trunc(Number(target)) - whole;
  }
  const remainder = whole % 10000;
  if (remainder === 0) return 0;
  return remainder >= 5000 ? 10000 - remainder : -remainder;
}
