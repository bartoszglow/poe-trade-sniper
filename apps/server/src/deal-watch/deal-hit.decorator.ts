import type { DealHitInfo, Listing, ManagedSearch } from '@poe-sniper/shared';
import { convertToExalted } from '../market-data/currency-rates.js';
import type { HitDecoration, HitDecorator } from '../search/hit-decorator.js';

/**
 * Per-search sync state the decorator needs on the detection hot path —
 * refreshed by the DealWatchService after every baseline compute. Rates are a
 * snapshot ON PURPOSE: `decorate` runs synchronously inside recordHits, so it
 * can never await the live rate source.
 */
export interface DealRuntimeSnapshot {
  ratesByApiId: Map<string, number> | null;
  divinePriceExalted: number | null;
  /** The live alert cutoff in exalted (recomputed with each baseline), null when unknowable. */
  cutoffExalted: number | null;
}

/**
 * Turns a detected listing on a deal-mode search into a `deal` alert with the
 * discount context (plan 41, D-dw-5). Policy:
 * - a deal-mode listing NEVER leaks as a bare `hit` — no baseline → `deal`
 *   with null discount fields;
 * - an unpriceable listing (unknown currency / no rate) is never suppressed —
 *   visibility over silence;
 * - a priced listing above the live cutoff is persisted but silent
 *   (sub-threshold suppression: passed the GGG cap, misses the live cutoff).
 */
export class DealHitDecorator implements HitDecorator {
  constructor(
    private readonly getRow: (searchId: string) => ManagedSearch | null,
    private readonly getSnapshot: (searchId: string) => DealRuntimeSnapshot | null,
    private readonly baselineStaleMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  decorate(listing: Listing): HitDecoration | null {
    const row = this.getRow(listing.searchId);
    const dealWatch = row?.dealWatch ?? null;
    if (dealWatch === null) return null;
    // Pre-derive (enable landed but the capped search hasn't) the row still
    // watches the operator's ORIGINAL query — those are ordinary hits, not
    // deals; converting them would alert on the original cap's listings.
    if (dealWatch.derivedCreatedAt === null) return null;

    const snapshot = this.getSnapshot(listing.searchId);
    const baseline = dealWatch.baseline;
    const priceExalted = this.listingPriceExalted(listing, snapshot);
    const baselineStale =
      dealWatch.status === 'baseline-stale' ||
      (baseline !== null && this.now() - Date.parse(baseline.computedAt) > this.baselineStaleMs);

    const deal: DealHitInfo = {
      baselineExalted: baseline?.amountExalted ?? null,
      discountPercent:
        baseline !== null && priceExalted !== null && baseline.amountExalted > 0
          ? (1 - priceExalted / baseline.amountExalted) * 100
          : null,
      discountExalted:
        baseline !== null && priceExalted !== null ? baseline.amountExalted - priceExalted : null,
      baselineStale,
    };

    const cutoffExalted = snapshot?.cutoffExalted ?? null;
    const suppressAlert =
      priceExalted !== null && cutoffExalted !== null && priceExalted > cutoffExalted;

    return {
      event: { type: 'deal', listing, deal },
      updatedEvent: { type: 'deal-updated', listing, deal },
      hitColumns: { deal },
      suppressAlert,
    };
  }

  private listingPriceExalted(
    listing: Listing,
    snapshot: DealRuntimeSnapshot | null,
  ): number | null {
    if (listing.price === null || listing.price.amount <= 0) return null;
    return convertToExalted(
      listing.price.amount,
      listing.price.currency,
      snapshot?.ratesByApiId ?? null,
    );
  }
}
