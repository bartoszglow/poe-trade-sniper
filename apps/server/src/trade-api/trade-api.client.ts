import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Listing, SessionState } from '@poe-sniper/shared';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { normalizeListing } from '../items/item-normalizer.js';
import { RateLimitGovernor } from '../ratelimit/rate-limit-governor.js';
import { SessionService } from '../session/session.service.js';

export interface TradeSearchRef {
  realm: string;
  league: string;
  searchId: string;
}

export interface SearchExecution {
  ids: string[];
  total: number;
  /** True when GGG answered 429 — the governor has already paused everything. */
  rateLimited: boolean;
}

export class TradeApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'TradeApiError';
  }
}

export class NoSessionError extends Error {
  constructor() {
    super('no PoE session — import or paste cookies first');
    this.name = 'NoSessionError';
  }
}

export type FetchFunction = typeof fetch;
export const HTTP_FETCH = Symbol('HTTP_FETCH');

/** Rate-limit policy keys — search/fetch/whisper/account budgets are separate. */
const POLICY_SEARCH = 'search';
const POLICY_FETCH = 'fetch';
const POLICY_WHISPER = 'whisper';
const POLICY_ACCOUNT = 'account';

/** The Referer the whisper endpoint expects — the search's trade page. */
export function searchPageUrl(baseUrl: string, search: TradeSearchRef): string {
  return `${baseUrl}/trade2/search/${search.realm}/${encodeURIComponent(search.league)}/${search.searchId}`;
}

/**
 * The ONLY module that talks to pathofexile.com. Owns the header discipline;
 * every call passes the rate-limit governor, carries a deadline, and logs
 * with a correlation id (never cookies).
 */
@Injectable()
export class TradeApiClient {
  private readonly logger = new Logger(TradeApiClient.name);
  private readonly fetchFn: FetchFunction;

  // Explicit @Inject on every param: tsx/esbuild emits no decorator metadata,
  // so implicit type-based injection breaks under the dev runner.
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SessionService) private readonly sessionService: SessionService,
    @Inject(RateLimitGovernor) private readonly governor: RateLimitGovernor,
    @Optional() @Inject(HTTP_FETCH) fetchFn: FetchFunction | null,
  ) {
    this.fetchFn = fetchFn ?? fetch;
  }

  /** GET /api/trade2/search/<realm>/<league>/<id> → the search's query JSON. */
  async resolveQuery(search: TradeSearchRef, correlationId: string): Promise<unknown> {
    const url = `${this.config.POE_BASE_URL}/api/trade2/search/${search.realm}/${encodeURIComponent(search.league)}/${search.searchId}`;
    const response = await this.request(POLICY_SEARCH, 0, url, {}, correlationId);
    if (!response.ok) {
      throw new TradeApiError(
        response.status,
        `resolve ${search.searchId}: HTTP ${response.status}`,
      );
    }
    const payload = (await response.json()) as { query?: unknown };
    if (!payload.query) {
      throw new TradeApiError(response.status, `resolve ${search.searchId}: no query in response`);
    }
    return payload.query;
  }

  /** POST the query, newest-first — id diffing is then trivial. */
  async executeSearch(
    search: TradeSearchRef,
    query: unknown,
    correlationId: string,
  ): Promise<SearchExecution> {
    const url = `${this.config.POE_BASE_URL}/api/trade2/search/${search.realm}/${encodeURIComponent(search.league)}`;
    const response = await this.request(
      POLICY_SEARCH,
      0,
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, sort: { indexed: 'desc' } }),
      },
      correlationId,
    );
    if (response.status === 429) {
      return { ids: [], total: 0, rateLimited: true };
    }
    if (!response.ok) {
      throw new TradeApiError(response.status, `search POST: HTTP ${response.status}`);
    }
    const payload = (await response.json()) as { result?: string[]; total?: number };
    return { ids: payload.result ?? [], total: payload.total ?? 0, rateLimited: false };
  }

  /** Batched /fetch (≤ FETCH_BATCH_SIZE ids per call, governor-spaced). */
  async fetchListings(
    search: TradeSearchRef,
    listingIds: string[],
    correlationId: string,
  ): Promise<Listing[]> {
    const listings: Listing[] = [];
    for (let start = 0; start < listingIds.length; start += this.config.FETCH_BATCH_SIZE) {
      const batch = listingIds.slice(start, start + this.config.FETCH_BATCH_SIZE);
      const url = `${this.config.POE_BASE_URL}/api/trade2/fetch/${batch.join(',')}?query=${search.searchId}&realm=${search.realm}`;
      const response = await this.request(
        POLICY_FETCH,
        this.config.FETCH_SPACING_MS,
        url,
        {},
        correlationId,
      );
      if (response.status === 429) {
        // Governor is paused already; the remainder of this round is dropped —
        // the next poll re-detects anything missed (ids stay unseen).
        this.logger.warn(`[${correlationId}] fetch rate-limited — dropping rest of round`);
        break;
      }
      if (!response.ok) {
        this.logger.warn(`[${correlationId}] fetch failed: HTTP ${response.status}`);
        continue;
      }
      const payload = (await response.json()) as { result?: unknown[] };
      const detectedAt = new Date().toISOString();
      for (const entry of payload.result ?? []) {
        listings.push(normalizeListing(entry, search.searchId, detectedAt));
      }
    }
    return listings;
  }

  /**
   * Browser-free hideout travel. The `X-Requested-With: XMLHttpRequest`
   * header is decisive — without it (and a search-page Referer) the endpoint
   * answers 403 code 6 even from a logged-in context. Also bypasses the
   * client-side "In demand. Teleport Anyway?" modal (api-notes).
   */
  async travel(hideoutToken: string, search: TradeSearchRef, correlationId: string): Promise<void> {
    const response = await this.request(
      POLICY_WHISPER,
      this.config.TRAVEL_MIN_SPACING_MS,
      `${this.config.POE_BASE_URL}/api/trade2/whisper`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          Referer: searchPageUrl(this.config.POE_BASE_URL, search),
        },
        body: JSON.stringify({ token: hideoutToken }),
      },
      correlationId,
    );
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const payload = (await response.json()) as { error?: { code?: number; message?: string } };
        if (payload.error?.message) {
          detail = `${detail}: ${payload.error.message} (code ${payload.error.code ?? '?'})`;
        }
      } catch {
        // non-JSON error body — keep the bare status
      }
      throw new TradeApiError(response.status, `travel: ${detail}`);
    }
    const payload = (await response.json()) as { success?: boolean };
    if (payload.success !== true) {
      throw new TradeApiError(response.status, 'travel: response did not confirm success');
    }
  }

  /** Login probe: /my-account answers 200 only for a real logged-in session. */
  async probeMyAccount(correlationId: string): Promise<boolean> {
    const response = await this.request(
      POLICY_ACCOUNT,
      0,
      `${this.config.POE_BASE_URL}/my-account`,
      { redirect: 'manual' },
      correlationId,
    );
    const loggedIn = response.status === 200;
    this.sessionService.markProbeResult(loggedIn);
    return loggedIn;
  }

  private session(): SessionState {
    const state = this.sessionService.getSession();
    if (!state) throw new NoSessionError();
    return state;
  }

  private async request(
    policyKey: string,
    spacingMs: number,
    url: string,
    init: RequestInit,
    correlationId: string,
  ): Promise<Response> {
    const sessionState = this.session();
    await this.governor.acquire(policyKey, spacingMs);
    const response = await this.fetchFn(url, {
      ...init,
      headers: {
        Cookie: this.sessionService.buildCookieHeader(sessionState),
        'User-Agent': sessionState.userAgent,
        Origin: this.config.POE_BASE_URL,
        ...init.headers,
      },
      signal: AbortSignal.timeout(this.config.OUTBOUND_TIMEOUT_MS),
    });
    this.governor.noteResponse(policyKey, response.status, response.headers);
    this.logger.debug(`[${correlationId}] ${init.method ?? 'GET'} ${url} → ${response.status}`);
    return response;
  }
}
