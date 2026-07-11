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
  isRetryableTravelFailure,
  offerKey,
  type DomainEvent,
  type Listing,
  type TravelEvent,
  type TravelFailureReason,
} from '@poe-sniper/shared';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { errorMessage } from '../util/error-message.js';
import { BuySessionLock } from '../events/buy-session-lock.service.js';
import { RealtimeBus } from '../events/realtime-bus.js';
import { RateLimitGovernor } from '../ratelimit/rate-limit-governor.js';
import { SearchManager } from '../search/search-manager.js';
import {
  TradeApiClient,
  TradeApiError,
  type TradeSearchRef,
} from '../trade-api/trade-api.client.js';
import { GameFocusService } from './game-focus.service.js';

/** Budget policies an auto-retry spends from (Tier-1 fetch + Tier-2 re-search). */
const RETRY_POLICIES = ['search', 'fetch'] as const;

export interface TravelRequest {
  hideoutToken: string;
  search: TradeSearchRef;
  listingId: string | null;
  itemName: string | null;
  source: 'manual' | 'auto';
  /** The offer's stable identity — set on auto travel so a failure can re-resolve
   *  this exact offer to learn whether it's gone (see refineAutoFailure). */
  offerKey?: string | null;
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
  /** At most one auto-failure retry in flight — a burst of failures must never
   *  fan out into a stack of SEARCH-bucket re-resolves (30-min lockout). */
  private retrying = false;
  private unsubscribe: (() => void) | null = null;
  private lastTravel: TravelStatus['lastTravel'] = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(TradeApiClient) private readonly tradeApi: TradeApiClient,
    @Inject(SearchManager) private readonly searchManager: SearchManager,
    @Inject(RealtimeBus) private readonly realtimeBus: RealtimeBus,
    @Inject(GameFocusService) private readonly gameFocus: GameFocusService,
    @Inject(BuySessionLock) private readonly buyLock: BuySessionLock,
    @Inject(RateLimitGovernor) private readonly governor: RateLimitGovernor,
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
    // A manual re-resolve spends a SEARCH-bucket hit (the 30-min-lockout tier).
    // Guard the governor exactly like the auto path (review REL-1): under the
    // reserve, refuse instead of draining detection/deal budget — a mashed burst
    // of Travel/Buy clicks across rows self-limits once headroom runs low. The
    // failure rides the travel-event channel so the card shows "try again".
    if (this.governor.minHeadroom(RETRY_POLICIES) < this.config.TRAVEL_RETRY_MIN_HEADROOM) {
      this.publishRetryFailure(
        searchId,
        listingId,
        null,
        'insufficient budget — try again shortly',
        'rate_limited',
      );
      return { found: false };
    }
    let listing: Listing | null;
    try {
      listing = await this.searchManager.refreshListing(searchId, listingId, offerKey);
    } catch (error) {
      // The tier-2 re-search can throw (review SRV-500) — surface it as a failed
      // travel event, never a bare 500 with no feedback and budget already spent.
      this.publishRetryFailure(searchId, listingId, null, errorMessage(error), 'server_error');
      return { found: false };
    }
    if (!listing?.hideoutToken) {
      this.publishRetryFailure(
        searchId,
        listingId,
        listing?.itemName ?? null,
        'no longer listed',
        'item_gone',
      );
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

  /** A failed manual re-resolve, tagged with the ORIGINAL listingId so the card
   *  that triggered it tracks the outcome. */
  private publishRetryFailure(
    searchId: string,
    listingId: string,
    itemName: string | null,
    detail: string,
    reason: TravelFailureReason,
  ): void {
    this.realtimeBus.publish({
      type: 'travel',
      phase: 'failed',
      source: 'manual',
      searchId,
      listingId,
      itemName,
      detail,
      reason,
      at: new Date().toISOString(),
    });
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
      offerKey: offerKey(listing),
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
          // Never whispered — auto-retry with a fresh token (or report it gone).
          void this.retryAutoFailure(request, null);
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
              ? classifyTravelFailure(error.status, error.gggCode, error.message)
              : 'unknown';
          this.publish('failed', request, errorMessage(error), reason);
          void this.retryAutoFailure(request, reason);
        }
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Auto-travel only: after a NON-definitive failure, do ONE automatic retry —
   * exactly what the operator's manual Retry does: re-resolve a fresh token and
   * travel again, or surface `item_gone` if the offer is gone (retryTravel owns
   * both branches). Deliberately narrow:
   *   - auto source only (manual already has an explicit Retry);
   *   - only for a RETRYABLE reason (isRetryableTravelFailure) — transient or
   *     indeterminate; item_gone/not_in_game/rate_limited/forbidden are definitive
   *     and would only waste budget;
   *   - single-flight + budget-gated: the re-resolve spends a SEARCH-bucket hit
   *     (the 30-min-lockout path), so a burst of failures collapses to at most one
   *     retry, and only when detection/deals have budget to spare.
   * Bounded to a single attempt: retryTravel re-enqueues as `source: 'manual'`, so
   * a second failure never re-enters this path — it's one auto-retry, not a loop.
   */
  private async retryAutoFailure(
    request: TravelRequest,
    reason: TravelFailureReason | null,
  ): Promise<void> {
    if (request.source !== 'auto' || request.listingId === null) return;
    if (!isRetryableTravelFailure(reason)) return;
    if (!request.offerKey) return;
    if (this.retrying) return;
    if (this.governor.minHeadroom(RETRY_POLICIES) < this.config.TRAVEL_RETRY_MIN_HEADROOM) return;
    this.retrying = true;
    try {
      await this.retryTravel(request.search.searchId, request.listingId, request.offerKey);
    } catch (error) {
      // A retry failure must never escalate — the original failure already stands.
      this.logger.warn(`auto-travel retry failed: ${errorMessage(error)}`);
    } finally {
      this.retrying = false;
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
