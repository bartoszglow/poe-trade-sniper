import type { DealHitInfo, Hit, ListingPrice } from '@poe-sniper/shared';
import type { MessageKey } from '../i18n/messages';
import { formatExaltedAmount, formatSignedExaltedAmount } from './deal-watch-display';
import { formatPriceAmount } from './format-price';

/**
 * Deal-hit display logic (plan 41 Phase 2, W2): discount badge text, the
 * "listed … · resale …" context line and the system-notification composition.
 * Pure functions — the translator is injected so both `useT()` (React tree)
 * and `translateStatic` (SSE side-effects) plug in, and tests stay DOM-free.
 */

/** Translator shape shared by `useT()` and `translateStatic`. */
export type DealTranslator = (key: MessageKey, vars?: Record<string, string | number>) => string;

/**
 * Discount chip text: '−32%' (typographic minus) rounded to a whole percent.
 * A negative discount (listed ABOVE the baseline — the baseline moved down
 * since the cap was derived) reads '+3%' so it never lies about a saving.
 * Null when the baseline was missing at persistence time (no discount math).
 */
export function formatDealDiscount(deal: DealHitInfo): string | null {
  if (deal.discountPercent === null) return null;
  const rounded = Math.round(deal.discountPercent);
  return rounded < 0 ? `+${Math.abs(rounded)}%` : `−${rounded}%`;
}

/** Listing price as plain text ('360 exalted'), or the localized no-price label. */
export function formatListedPrice(price: ListingPrice | null, translate: DealTranslator): string {
  if (!price) return translate('item.noPrice');
  return `${formatPriceAmount(price.amount)} ${price.currency}`;
}

/**
 * The flip-context line: 'listed 360 exalted · resale ≈ 74.8 div (+2.1 div)'.
 * Amounts are divine-aware via the rate snapshotted on the deal itself, so
 * historical alerts keep converting with the rate that was true when they
 * fired. Falls back to the baseline-pending variant when the discount math is
 * absent; the profit carries its own sign so a negative margin reads '(−12 ex)'.
 */
export function composeDealContext(
  price: ListingPrice | null,
  deal: DealHitInfo,
  translate: DealTranslator,
): string {
  const listed = formatListedPrice(price, translate);
  if (deal.baselineExalted === null || deal.discountExalted === null) {
    return translate('deal.contextPending', { price: listed });
  }
  return translate('deal.context', {
    price: listed,
    baseline: formatExaltedAmount(deal.baselineExalted, deal.divinePriceExalted),
    profit: formatSignedExaltedAmount(deal.discountExalted, deal.divinePriceExalted),
  });
}

/**
 * System-notification title + body for a `deal` event: 'DEAL −32% · <item>'
 * (or the no-discount variant) over the flip-context body.
 */
export function composeDealNotification(
  itemName: string,
  price: ListingPrice | null,
  deal: DealHitInfo,
  translate: DealTranslator,
): { title: string; body: string } {
  const discount = formatDealDiscount(deal);
  const title =
    discount === null
      ? translate('notify.dealTitlePending', { item: itemName })
      : translate('notify.dealTitle', { discount, item: itemName });
  return { title, body: composeDealContext(price, deal, translate) };
}

/**
 * Activity-feed kind for a persisted hit row: deal-mode hits (row.deal
 * non-null, even with pending discount fields) get their own 'deal' kind.
 */
export function feedKindForHit(hit: Pick<Hit, 'deal'>): 'deal' | 'hit' {
  return hit.deal ? 'deal' : 'hit';
}
