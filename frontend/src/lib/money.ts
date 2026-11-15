import { useEffect, useState } from "react";

/**
 * Money unit (واحد پول). Amounts are STORED in Toman everywhere in
 * the app; the profile setting only changes how amounts are shown
 * and entered: with «ریال» selected, displays multiply by 10 and
 * inputs divide back — the stored values never change meaning.
 */

export type CurrencyUnit = "toman" | "rial";

let current: CurrencyUnit = "toman";
const listeners = new Set<() => void>();

export function setCurrencyUnit(unit: string | null | undefined): void {
  const next: CurrencyUnit = unit === "rial" ? "rial" : "toman";
  if (next === current) return;
  current = next;
  listeners.forEach((fn) => fn());
}

export function getCurrencyUnit(): CurrencyUnit {
  return current;
}

export function currencyLabel(unit: CurrencyUnit = current): string {
  return unit === "rial" ? "ریال" : "تومان";
}

/** Stored (Toman) → display value in the active unit. */
export function toDisplayAmount(stored: number): number {
  return current === "rial" ? stored * 10 : stored;
}

/** Display value in the active unit → stored (Toman). */
export function fromDisplayAmount(display: number): number {
  return current === "rial" ? display / 10 : display;
}

const faNum = new Intl.NumberFormat("fa-IR");

/** «۱۲٬۰۰۰ تومان» — formatted amount with the active unit label. */
export function formatMoney(
  stored: number | string | null | undefined,
): string {
  const value = Math.round(toDisplayAmount(Number(stored) || 0));
  return `${faNum.format(value)} ${currencyLabel()}`;
}

export function useCurrency() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return {
    unit: current,
    label: currencyLabel(),
    toDisplay: toDisplayAmount,
    fromDisplay: fromDisplayAmount,
    formatMoney,
  };
}
