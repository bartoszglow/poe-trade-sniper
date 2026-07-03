import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  type LeagueInfo,
  type Listing,
  type NetworkOutcome,
  type SessionState,
  type StatDictionaryEntry,
  tradeSearchPageUrl,
} from '@poe-sniper/shared';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { errorMessage } from '../util/error-message.js';
import { OutboundGuard } from '../guard/outbound-guard.js';
import { NetworkLog } from '../network/network-log.service.js';
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

/** A price-check listing, straight from /fetch (unnormalized; #37). */
export interface RawTradeListing {
  price: { amount: number; currency: string } | null;
  seller: string | null;
  indexedAt: string | null;
  /** GGG's pre-templated buy whisper for this listing, when present. */
  whisper: string | null;
}

interface RawTradeResult {
  listing?: {
    price?: { amount?: number; currency?: string } | null;
    account?: { name?: string } | null;
    indexed?: string | null;
    // TODO(verify): observed on the /fetch listing object (same object we already
    // read hideout_token from in the detection normalizer); confirm live shape.
    whisper?: string | null;
  } | null;
}

export class TradeApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** GGG error body `error.code` when present — lets callers classify the failure. */
    readonly gggCode: number | null = null,
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

export class GuardTrippedError extends Error {
  constructor() {
    super('safety guard tripped — all GGG traffic halted until operator reset');
    this.name = 'GuardTrippedError';
  }
}

export type FetchFunction = typeof fetch;
export const HTTP_FETCH = Symbol('HTTP_FETCH');

/** Rate-limit policy keys — search/fetch/whisper/account budgets are separate. */
const POLICY_SEARCH = 'search';
const POLICY_FETCH = 'fetch';
const POLICY_WHISPER = 'whisper';
const POLICY_ACCOUNT = 'account';
const POLICY_DATA = 'data';

/** The Referer the whisper endpoint expects — the search's trade page. Delegates
 *  to the shared url builder so the format lives in exactly one place. */
export function searchPageUrl(baseUrl: string, search: TradeSearchRef): string {
  return tradeSearchPageUrl(search.realm, search.league, search.searchId, baseUrl);
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
    @Inject(OutboundGuard) private readonly guard: OutboundGuard,
    @Inject(NetworkLog) private readonly networkLog: NetworkLog,
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
        // One malformed listing from the undocumented GGG payload must never
        // take down detection — log the offender (id only, no body) and skip.
        // TODO(verify): capture the real shape that breaks the normalizer and
        // teach it to parse it (docs/integration/api-notes.md).
        try {
          listings.push(normalizeListing(entry, search.searchId, detectedAt));
        } catch (error) {
          const listingId = (entry as { id?: string } | null)?.id ?? '(unknown)';
          this.logger.warn(
            `[${correlationId}] skipped unparseable listing ${listingId}: ${errorMessage(error)}`,
          );
        }
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
      let gggCode: number | null = null;
      try {
        const payload = (await response.json()) as { error?: { code?: number; message?: string } };
        if (payload.error?.message) {
          gggCode = payload.error.code ?? null;
          detail = `${detail}: ${payload.error.message} (code ${payload.error.code ?? '?'})`;
        }
      } catch {
        // non-JSON error body — keep the bare status
      }
      throw new TradeApiError(response.status, `travel: ${detail}`, gggCode);
    }
    const payload = (await response.json()) as { success?: boolean };
    if (payload.success !== true) {
      throw new TradeApiError(response.status, 'travel: response did not confirm success');
    }
  }

  /**
   * League list — `{result: [{id, realm, text}]}` where `id` is the URL
   * league segment. Verified live 2026-06-12 (api-notes).
   */
  async fetchLeagues(correlationId: string): Promise<LeagueInfo[]> {
    const response = await this.request(
      POLICY_DATA,
      0,
      `${this.config.POE_BASE_URL}/api/trade2/data/leagues`,
      {},
      correlationId,
    );
    if (!response.ok) {
      throw new TradeApiError(response.status, `leagues: HTTP ${response.status}`);
    }
    const payload = (await response.json()) as {
      result?: Array<{ id?: string; text?: string }>;
    };
    return (payload.result ?? [])
      .filter((entry): entry is { id: string; text?: string } => typeof entry.id === 'string')
      .map((entry) => ({ id: entry.id, text: entry.text ?? entry.id }));
  }

  /**
   * Stat dictionary — `{result: [{id, entries: [{id, text, type}]}]}`,
   * flattened to one list. Static game data; callers cache it.
   */
  async fetchStatsDictionary(correlationId: string): Promise<StatDictionaryEntry[]> {
    const response = await this.request(
      POLICY_DATA,
      0,
      `${this.config.POE_BASE_URL}/api/trade2/data/stats`,
      {},
      correlationId,
    );
    if (!response.ok) {
      throw new TradeApiError(response.status, `stats: HTTP ${response.status}`);
    }
    const payload = (await response.json()) as {
      result?: Array<{ entries?: Array<{ id?: string; text?: string; type?: string }> }>;
    };
    const entries: StatDictionaryEntry[] = [];
    for (const group of payload.result ?? []) {
      for (const entry of group.entries ?? []) {
        if (typeof entry.id === 'string' && typeof entry.text === 'string') {
          entries.push({ id: entry.id, text: entry.text, type: entry.type ?? '' });
        }
      }
    }
    return entries;
  }

  /**
   * Raw GET of a trade2 data endpoint (`stats` / `items` / `static` / `filters`)
   * for the price-check dictionary (#37). Uses the DATA policy (cheap, cached by
   * the caller). Returns the parsed JSON as-is; the caller owns the shape.
   */
  async fetchTradeData(
    dataset: 'stats' | 'items' | 'static' | 'filters',
    correlationId: string,
  ): Promise<unknown> {
    const response = await this.request(
      POLICY_DATA,
      0,
      `${this.config.POE_BASE_URL}/api/trade2/data/${dataset}`,
      {},
      correlationId,
    );
    if (!response.ok) {
      throw new TradeApiError(response.status, `data/${dataset}: HTTP ${response.status}`);
    }
    return response.json();
  }

  /**
   * Run an ad-hoc trade2 search for a price check (#37): POST the query, then
   * fetch the top results as raw listing JSON (price/account/indexed only —
   * NOT normalized like detection). Realm/league come from the ref. Returns
   * `{ rateLimited }` when GGG 429s so the caller degrades instead of throwing.
   */
  async priceSearch(
    realm: string,
    league: string,
    query: unknown,
    limit: number,
    correlationId: string,
  ): Promise<{ listings: RawTradeListing[]; total: number; rateLimited: boolean }> {
    const searchUrl = `${this.config.POE_BASE_URL}/api/trade2/search/${realm}/${encodeURIComponent(league)}`;
    const searchResponse = await this.request(
      POLICY_SEARCH,
      0,
      searchUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(query),
      },
      correlationId,
    );
    if (searchResponse.status === 429) return { listings: [], total: 0, rateLimited: true };
    if (!searchResponse.ok) {
      throw new TradeApiError(searchResponse.status, `price search: HTTP ${searchResponse.status}`);
    }
    const searchPayload = (await searchResponse.json()) as {
      id?: string;
      result?: string[];
      total?: number;
    };
    const ids = (searchPayload.result ?? []).slice(0, limit);
    if (ids.length === 0 || !searchPayload.id) {
      return { listings: [], total: searchPayload.total ?? 0, rateLimited: false };
    }
    const fetchUrl = `${this.config.POE_BASE_URL}/api/trade2/fetch/${ids.join(',')}?query=${searchPayload.id}&realm=${realm}`;
    const fetchResponse = await this.request(
      POLICY_FETCH,
      this.config.FETCH_SPACING_MS,
      fetchUrl,
      {},
      correlationId,
    );
    if (fetchResponse.status === 429) return { listings: [], total: 0, rateLimited: true };
    if (!fetchResponse.ok) {
      throw new TradeApiError(fetchResponse.status, `price fetch: HTTP ${fetchResponse.status}`);
    }
    const fetchPayload = (await fetchResponse.json()) as { result?: RawTradeResult[] };
    const listings: RawTradeListing[] = (fetchPayload.result ?? []).map((entry) => ({
      price: entry?.listing?.price
        ? {
            amount: entry.listing.price.amount ?? 0,
            currency: entry.listing.price.currency ?? '',
          }
        : null,
      seller: entry?.listing?.account?.name ?? null,
      indexedAt: entry?.listing?.indexed ?? null,
      whisper: entry?.listing?.whisper ?? null,
    }));
    return { listings, total: searchPayload.total ?? listings.length, rateLimited: false };
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
    const method = init.method ?? 'GET';
    const startMs = Date.now();

    let sessionState: SessionState;
    try {
      sessionState = this.session();
    } catch (error) {
      this.recordHttp(
        method,
        url,
        policyKey,
        correlationId,
        startMs,
        null,
        'no-session',
        null,
        null,
      );
      throw error;
    }
    if (!this.guard.allowHttp(`${method} ${url}`)) {
      this.recordHttp(
        method,
        url,
        policyKey,
        correlationId,
        startMs,
        null,
        'guard-blocked',
        null,
        null,
      );
      throw new GuardTrippedError();
    }

    await this.governor.acquire(policyKey, spacingMs);
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        ...init,
        headers: {
          Cookie: this.sessionService.buildCookieHeader(sessionState),
          'User-Agent': sessionState.userAgent,
          Origin: this.config.POE_BASE_URL,
          ...init.headers,
        },
        signal: AbortSignal.timeout(this.config.OUTBOUND_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      this.recordHttp(
        method,
        url,
        policyKey,
        correlationId,
        startMs,
        null,
        timedOut ? 'timeout' : 'network-error',
        errorMessage(error),
        null,
      );
      throw error;
    }

    this.governor.noteResponse(policyKey, response.status, response.headers);
    this.recordHttp(
      method,
      url,
      policyKey,
      correlationId,
      startMs,
      response.status,
      httpOutcome(response.status),
      null,
      extractRateLimitHeaders(response.headers),
    );
    this.logger.debug(`[${correlationId}] ${method} ${url} → ${response.status}`);
    return response;
  }

  /** Build a REDACTED network entry (no cookies/UA/token) and hand it to the log. */
  private recordHttp(
    method: string,
    url: string,
    policy: string,
    correlationId: string,
    startMs: number,
    status: number | null,
    outcome: NetworkOutcome,
    detail: string | null,
    rateLimit: Record<string, string> | null,
  ): void {
    this.networkLog.record({
      at: new Date(startMs).toISOString(),
      channel: 'http',
      method,
      url,
      policy,
      correlationId,
      status,
      durationMs: Date.now() - startMs,
      outcome,
      detail,
      rateLimit,
    });
  }
}

function httpOutcome(status: number): NetworkOutcome {
  if (status === 429) return 'rate-limited';
  if (status < 300) return 'ok';
  if (status < 500) return 'client-error';
  return 'server-error';
}

/** Only the safe `x-rate-limit-*` headers — never auth/session headers. */
function extractRateLimitHeaders(headers: Headers): Record<string, string> | null {
  const collected: Record<string, string> = {};
  headers.forEach((value, name) => {
    if (name.toLowerCase().startsWith('x-rate-limit')) collected[name] = value;
  });
  return Object.keys(collected).length > 0 ? collected : null;
}
