import type { Listing } from '@poe-sniper/shared';
import type { AppConfig } from '../config/env.js';
import type { TradeApiClient } from '../trade-api/trade-api.client.js';
import type { DetectionEngine, EngineCallbacks, EngineContext } from './detection-engine.js';

/** The slice of TradeApiClient a poll engine needs (kept narrow for tests). */
export type PollTradeApi = Pick<TradeApiClient, 'executeSearch' | 'fetchListings'>;

type PollConfig = Pick<AppConfig, 'MAX_FRESH_IDS_PER_TICK' | 'SEEN_IDS_CAP'>;

/**
 * Fallback detection while GGG's live backend is down: re-run the search
 * (newest-first) and diff ids against a bounded seen-set. Ticks are driven
 * externally by the SearchManager's round-robin scheduler — the engine never
 * owns a timer, so N searches still spend one search-POST per tick total.
 */
export class PollEngine implements DetectionEngine {
  readonly kind = 'poll';

  private readonly seenListingIds = new Set<string>();
  private baseline = true;
  private context: EngineContext | null = null;
  private callbacks: EngineCallbacks | null = null;
  private running = false;

  constructor(
    private readonly config: PollConfig,
    private readonly tradeApi: PollTradeApi,
  ) {}

  start(context: EngineContext, callbacks: EngineCallbacks): void {
    this.context = context;
    this.callbacks = callbacks;
    this.running = true;
    this.baseline = true;
    this.seenListingIds.clear();
    callbacks.onStatus('active', 'polling (live ws unavailable or not yet probed)');
  }

  stop(): void {
    this.running = false;
    this.callbacks?.onStatus('stopped', null);
  }

  /** One scheduler tick: a single search POST, then fetch only what's new. */
  async tick(): Promise<void> {
    if (!this.running || !this.context || !this.callbacks) return;
    const { search, query, correlationId } = this.context;

    const execution = await this.tradeApi.executeSearch(search, query, correlationId);
    // The engine may have been stopped (archive / disable / pause) while the
    // search POST was in flight — a late status callback must not relabel a
    // watcher that already published its terminal state.
    if (!this.running) return;
    if (execution.rateLimited) {
      this.callbacks.onStatus('degraded', 'rate-limited');
      return;
    }

    const freshIds = execution.ids.filter((listingId) => !this.seenListingIds.has(listingId));
    for (const listingId of freshIds) {
      this.seenListingIds.add(listingId);
    }
    this.evictOverCap();

    if (this.baseline) {
      // First round only marks the current page as seen — alerting on it
      // would replay listings that existed before the search was added.
      this.baseline = false;
      this.callbacks.onStatus('active', `baseline: ${execution.ids.length} listings marked seen`);
      return;
    }
    if (freshIds.length === 0) return;

    const idsToFetch = freshIds.slice(0, this.config.MAX_FRESH_IDS_PER_TICK);
    const listings: Listing[] = await this.tradeApi.fetchListings(
      search,
      idsToFetch,
      correlationId,
    );
    if (this.running && listings.length > 0) {
      this.callbacks.onListings(listings);
    }
  }

  /** Insertion-order eviction keeps memory bounded on long-running searches. */
  private evictOverCap(): void {
    while (this.seenListingIds.size > this.config.SEEN_IDS_CAP) {
      const oldest = this.seenListingIds.values().next().value;
      if (oldest === undefined) break;
      this.seenListingIds.delete(oldest);
    }
  }
}
