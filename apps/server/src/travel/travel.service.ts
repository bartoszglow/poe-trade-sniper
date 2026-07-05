import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  classifyTravelFailure,
  type DomainEvent,
  type TravelEvent,
  type TravelFailureReason,
} from '@poe-sniper/shared';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { errorMessage } from '../util/error-message.js';
import { BuySessionLock } from '../events/buy-session-lock.service.js';
import { RealtimeBus } from '../events/realtime-bus.js';
import { SearchManager } from '../search/search-manager.js';
import {
  TradeApiClient,
  TradeApiError,
  type TradeSearchRef,
} from '../trade-api/trade-api.client.js';
import { GameFocusService } from './game-focus.service.js';

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
  lastTravel: Pick<
    TravelEvent,
    'phase' | 'source' | 'itemName' | 'detail' | 'reason' | 'at'
  > | null;
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
    @Inject(GameFocusService) private readonly gameFocus: GameFocusService,
    @Inject(BuySessionLock) private readonly buyLock: BuySessionLock,
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

  /** Enqueue a travel; returns the queue position (0 = next), or -1 if suspended
   *  because a buy sequence is in progress (live hits still show, but we don't
   *  travel/buy until the current buy — incl. return-to-hideout — finishes). */
  enqueue(request: TravelRequest): { position: number } {
    if (this.buyLock.isActive) {
      this.logger.log(`travel suspended — buy in progress (listing ${request.listingId})`);
      return { position: -1 };
    }
    const queued: QueuedTravel = { ...request, enqueuedAtMs: Date.now() };
    this.queue.push(queued);
    this.publish('queued', queued, null);
    void this.processQueue();
    return { position: this.queue.length - 1 };
  }

  /**
   * Manual travel RETRY for an aged live hit. The stored token has expired, so re-resolve
   * the listing (SearchManager.refreshListing → a FRESH token) and travel with that. The
   * event is tagged with the ORIGINAL listingId so the live-hits card tracks the retry. If
   * the offer is gone, emit a `failed` ("no longer listed") and report it. Manual + a single
   * re-resolve per click — never an auto loop (the Tier-2 re-search bucket lockout is 30 min).
   */
  async retryTravel(
    searchId: string,
    listingId: string,
    offerKey: string,
  ): Promise<{ found: boolean }> {
    const search = this.searchManager.getSearchRef(searchId);
    if (!search) return { found: false };
    const listing = await this.searchManager.refreshListing(searchId, listingId, offerKey);
    if (!listing?.hideoutToken) {
      this.realtimeBus.publish({
        type: 'travel',
        phase: 'failed',
        source: 'manual',
        searchId,
        listingId,
        itemName: listing?.itemName ?? null,
        detail: 'no longer listed',
        reason: 'item_gone',
        at: new Date().toISOString(),
      });
      return { found: false };
    }
    this.enqueue({
      hideoutToken: listing.hideoutToken,
      search,
      listingId,
      itemName: listing.itemName,
      source: 'manual',
    });
    return { found: true };
  }

  private maybeAutoTravel(event: DomainEvent): void {
    // Deal alerts (plan 41) gate exactly like plain hits; the `*-updated`
    // re-serve twins never trigger actions (offer-registry contract).
    if (event.type !== 'hit' && event.type !== 'deal') return;
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
        // Pull the (backgrounded, low-FPS) game window to the foreground the
        // moment travel begins — so it's at full FPS by the time the character
        // lands, and a manual Travel/Buy snaps the operator straight to the game
        // (auto + manual alike) instead of leaving them on the app.
        this.gameFocus.focus();
        try {
          await this.tradeApi.travel(request.hideoutToken, request.search, randomUUID());
          this.rememberTraveled(request.listingId);
          this.publish('success', request, null);
        } catch (error) {
          const reason =
            error instanceof TradeApiError
              ? classifyTravelFailure(error.status, error.gggCode)
              : 'unknown';
          this.publish('failed', request, errorMessage(error), reason);
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
    reason: TravelFailureReason | null = null,
  ): void {
    const event: TravelEvent = {
      type: 'travel',
      phase,
      source: request.source,
      searchId: request.search.searchId,
      listingId: request.listingId,
      itemName: request.itemName,
      detail,
      reason,
      at: new Date().toISOString(),
    };
    if (phase !== 'queued') {
      this.lastTravel = {
        phase,
        source: event.source,
        itemName: event.itemName,
        detail,
        reason,
        at: event.at,
      };
    }
    if (phase === 'failed') {
      this.logger.warn(`travel ${request.listingId ?? '?'} failed: ${detail ?? 'unknown'}`);
    }
    this.realtimeBus.publish(event);
  }
}
