import { Inject, Injectable } from '@nestjs/common';
import { offerKey, type Listing } from '@poe-sniper/shared';
import { APP_CONFIG, type AppConfig } from '../config/env.js';

/**
 * Outcome of folding a detected listing into the registry:
 *  - `new`       first time we've seen this offer            → emit `hit` (auto-travel/buy act)
 *  - `updated`   same offer, NEW listing id                 → emit `hit-updated` (feed only)
 *  - `duplicate` same offer, id already known (poll re-serve) → drop silently
 */
export type IngestOutcome = 'new' | 'updated' | 'duplicate';

interface OfferEntry {
  /** Every GGG listing id served for this offer (insertion order = oldest→newest). */
  listingIds: Set<string>;
}

/**
 * The single grouping authority for live offers. GGG re-serves the same physical offer
 * under fresh result-hash ids (especially right after a travel re-query), which a plain
 * listingId key treats as a brand-new hit — duplicating the feed AND re-triggering
 * auto-travel/auto-buy. This collapses listings by their OFFER identity so each offer is
 * acted on once and shown as one entity. Auto-travel/auto-buy stay oblivious to grouping:
 * they only ever see `hit` (a `new` offer); re-serves arrive as `hit-updated`.
 *
 * Global (not per-search — the same offer matched by two searches is one offer; the first
 * to detect it owns the auto-action decision), insertion-ordered and FIFO-bounded.
 */
@Injectable()
export class LiveOfferRegistry {
  private readonly offers = new Map<string, OfferEntry>();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  ingest(listing: Listing): IngestOutcome {
    const key = offerKey(listing);
    const entry = this.offers.get(key);
    if (!entry) {
      this.offers.set(key, { listingIds: new Set([listing.listingId]) });
      this.evict();
      return 'new';
    }
    // Touch for recency so eviction drops the least-recently-active offers, not this one.
    this.offers.delete(key);
    this.offers.set(key, entry);
    if (entry.listingIds.has(listing.listingId)) return 'duplicate';
    entry.listingIds.add(listing.listingId);
    return 'updated';
  }

  /** FIFO eviction (Map preserves insertion order; we re-insert on touch). */
  private evict(): void {
    const cap = this.config.SEEN_IDS_CAP;
    while (this.offers.size > cap) {
      const oldest = this.offers.keys().next().value;
      if (oldest === undefined) break;
      this.offers.delete(oldest);
    }
  }
}
