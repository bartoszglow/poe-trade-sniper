import type { DealWatchUnit } from '@poe-sniper/shared';

/**
 * THE currency-conversion rule, in one place (review F12 — it was implemented
 * three times before). Pure and synchronous on purpose: the deal decorator runs
 * inside the detection hot path and can never await the live rate source, so
 * every caller passes an already-fetched rate snapshot
 * (`Poe2ScoutClient.currencyRatesByApiId` / `divinePriceExalted`).
 *
 * Best-effort semantics: an unknown currency code or a missing rate yields
 * null — "unpriceable", never zero — and the caller excludes the listing or
 * degrades honestly.
 */

/** A listing amount in a GGG currency code (e.g. 'divine') expressed in exalted. */
export function convertToExalted(
  amount: number,
  gggCurrencyCode: string,
  ratesByApiId: ReadonlyMap<string, number> | null,
): number | null {
  // The league base needs no rate (and must not depend on one).
  if (gggCurrencyCode === 'exalted') return amount;
  const rate = ratesByApiId?.get(gggCurrencyCode);
  return rate === undefined ? null : amount * rate;
}

/** A unit-denominated amount (operator threshold input, D-dw-11) in exalted. */
export function unitToExalted(
  amountInUnit: number,
  unit: DealWatchUnit,
  divinePriceExalted: number | null,
): number | null {
  if (unit === 'exalted') return amountInUnit;
  return divinePriceExalted === null ? null : amountInUnit * divinePriceExalted;
}

/** An exalted amount expressed in the watch's display/threshold unit (D-dw-11). */
export function exaltedToUnit(
  amountExalted: number,
  unit: DealWatchUnit,
  divinePriceExalted: number | null,
): number | null {
  if (unit === 'exalted') return amountExalted;
  if (divinePriceExalted === null || divinePriceExalted <= 0) return null;
  return amountExalted / divinePriceExalted;
}
