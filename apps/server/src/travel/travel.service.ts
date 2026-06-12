import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { DomainEvent, TravelEvent } from '@poe-sniper/shared';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { RealtimeBus } from '../events/realtime-bus.js';
import { SearchManager } from '../search/search-manager.js';
import { TradeApiClient, type TradeSearchRef } from '../trade-api/trade-api.client.js';

export interface TravelRequest {
  hideoutToken: string;
  search: TradeSearchRef;
  listingId: string | null;
  itemName: string | null;
  source: 'manual' | 'auto';
}

interface QueuedTravel extends TravelRequest {
  enqueuedAtMs: number;
}

export interface TravelStatus {
  queueLength: number;
  lastTravel: Pick<TravelEvent, 'phase' | 'source' | 'itemName' | 'detail' | 'at'> | null;
}

/**
 * Hideout travel orchestration. Strictly one travel at a time — each one
 * teleports the real character — and stale tokens are dropped, never fired
 * (hideout tokens die at ~300 s).
 *
 * Auto-travel is event-driven: the service subscribes to `hit` events and
 * enqueues only when the search opted in AND the listing carries a token.
 */
@Injectable()
export class TravelService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(TravelService.name);
  private readonly queue: QueuedTravel[] = [];
  /**
   * Listing ids already traveled to (insertion-ordered, bounded). A listing
   * re-enters the live stream as "new" when the buyer returns to hideout
   * without purchasing — auto-travel must not teleport to it again. Manual
   * travel is always allowed; a failed travel is not recorded, so the next
   * re-detection may retry.
   */
  private readonly traveledListingIds = new Set<string>();
  private processing = false;
  private unsubscribe: (() => void) | null = null;
  private lastTravel: TravelStatus['lastTravel'] = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(TradeApiClient) private readonly tradeApi: TradeApiClient,
    @Inject(SearchManager) private readonly searchManager: SearchManager,
    @Inject(RealtimeBus) private readonly realtimeBus: RealtimeBus,
  ) {}

  onApplicationBootstrap(): void {
    this.unsubscribe = this.realtimeBus.subscribe((event) => this.maybeAutoTravel(event));
  }

  onApplicationShutdown(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.queue.length = 0;
  }

  status(): TravelStatus {
    return { queueLength: this.queue.length, lastTravel: this.lastTravel };
  }

  /** Enqueue a travel; returns the queue position (0 = next). */
  enqueue(request: TravelRequest): { position: number } {
    const queued: QueuedTravel = { ...request, enqueuedAtMs: Date.now() };
    this.queue.push(queued);
    this.publish('queued', queued, null);
    void this.processQueue();
    return { position: this.queue.length - 1 };
  }

  private maybeAutoTravel(event: DomainEvent): void {
    if (event.type !== 'hit') return;
    const { listing } = event;
    if (!listing.hideoutToken) return;
    if (!this.searchManager.isAutoTravelEnabled(listing.searchId)) return;
    if (this.traveledListingIds.has(listing.listingId)) {
      this.logger.log(`auto travel skipped — already traveled to listing ${listing.listingId}`);
      return;
    }
    const search = this.searchManager.getSearchRef(listing.searchId);
    if (!search) return;
    this.enqueue({
      hideoutToken: listing.hideoutToken,
      search,
      listingId: listing.listingId,
      itemName: listing.itemName,
      source: 'auto',
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      for (;;) {
        const request = this.queue.shift();
        if (!request) return;

        if (Date.now() - request.enqueuedAtMs > this.config.TRAVEL_TOKEN_MAX_AGE_MS) {
          this.publish('failed', request, 'token expired while queued — dropped');
          continue;
        }

        this.publish('started', request, null);
        try {
          await this.tradeApi.travel(request.hideoutToken, request.search, randomUUID());
          this.rememberTraveled(request.listingId);
          this.publish('success', request, null);
        } catch (error) {
          this.publish('failed', request, error instanceof Error ? error.message : String(error));
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private rememberTraveled(listingId: string | null): void {
    if (listingId === null) return;
    this.traveledListingIds.delete(listingId);
    this.traveledListingIds.add(listingId);
    while (this.traveledListingIds.size > this.config.TRAVEL_DEDUPE_MAX_ENTRIES) {
      const oldest = this.traveledListingIds.values().next().value;
      if (oldest === undefined) break;
      this.traveledListingIds.delete(oldest);
    }
  }

  private publish(
    phase: TravelEvent['phase'],
    request: TravelRequest,
    detail: string | null,
  ): void {
    const event: TravelEvent = {
      type: 'travel',
      phase,
      source: request.source,
      searchId: request.search.searchId,
      listingId: request.listingId,
      itemName: request.itemName,
      detail,
      at: new Date().toISOString(),
    };
    if (phase !== 'queued') {
      this.lastTravel = {
        phase,
        source: event.source,
        itemName: event.itemName,
        detail,
        at: event.at,
      };
    }
    if (phase === 'failed') {
      this.logger.warn(`travel ${request.listingId ?? '?'} failed: ${detail ?? 'unknown'}`);
    }
    this.realtimeBus.publish(event);
  }
}
