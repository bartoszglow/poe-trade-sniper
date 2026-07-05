import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { ListingPrice } from '@poe-sniper/shared';
import { errorMessage } from '../util/error-message.js';
import { FetchFunction, HTTP_FETCH } from '../trade-api/trade-api.client.js';

/** The real poe2scout API base (verified 2026-07-03; see docs/integration). */
const BASE_URL = 'https://api.poe2scout.com/api/poe2';
/** Fixed-value prices barely move within a check session; cache generously. */
const CACHE_TTL_MS = 15 * 60 * 1000;
/** Bound the cache — insertion-order eviction keeps memory flat over a session. */
const CACHE_MAX_ENTRIES = 500;
/** Currency categories poe2scout groups fixed-value stackables under. */
const CURRENCY_CATEGORIES = ['currency', 'fragments', 'runes', 'essences', 'omen', 'catalysts'];
/** Deadline for every poe2scout fetch — a stalled upstream must degrade to null,
 *  never hang the price-check handler (matches the trade-api OUTBOUND_TIMEOUT_MS). */
const POE2SCOUT_TIMEOUT_MS = 15_000;

interface CacheEntry {
  at: number;
  price: ListingPrice | null;
}

/** One category-fetch pass fills BOTH keyings — Text for price-check name
 *  lookups, ApiId for deal-watch rate lookups — so the second consumer adds
 *  zero extra poe2scout load. */
interface CurrencyPriceMaps {
  at: number;
  pricesByText: Map<string, number>;
  pricesByApiId: Map<string, number>;
}

/** Parsed `GET /Leagues` entry (fields evidenced 2026-07-03/2026-07-05,
 *  api-notes.md poe2scout section). */
interface Poe2ScoutLeague {
  value: string;
  isCurrent: boolean;
  /** Divine Orb price in the league base currency, or null when absent/non-positive. */
  divinePriceExalted: number | null;
  /** The league base currency's GGG code — 'exalted' on every observed league. */
  baseCurrencyApiId: string | null;
}

interface RawPoe2ScoutLeague {
  Value?: string;
  IsCurrent?: boolean;
  DivinePrice?: number;
  BaseCurrencyApiId?: string;
}

/**
 * Fixed-value item prices + currency exchange rates from the poe2scout
 * aggregator. Serves BOTH price-check (#37, D-pc-4: name → price) and
 * deal-watch (plan 41, D-dw-3: ApiId-keyed rates + DivinePrice for
 * normalization to exalted). NON-GGG host — never touches the trade
 * rate-limit budget. Uniques come from the `Items` search endpoint;
 * currency/runes/essences from `Currencies`. Prices are in the league base
 * currency (exalted). Best-effort: any failure returns null and the caller
 * shows an "unpriced" state rather than erroring.
 */
@Injectable()
export class Poe2ScoutClient {
  private readonly logger = new Logger(Poe2ScoutClient.name);
  private readonly fetchFn: FetchFunction;
  private readonly cache = new Map<string, CacheEntry>();
  /** Per-league currency price maps (Text- and ApiId-keyed), cached — the
   *  currency lists are small. */
  private readonly currencyCache = new Map<string, CurrencyPriceMaps>();
  /** Parsed `GET /Leagues` payload, cached — league set + DivinePrice rarely
   *  change within a session (one fetch feeds currentLeague AND divinePrice). */
  private leaguesCache: { at: number; leagues: Poe2ScoutLeague[] } | null = null;

  constructor(@Optional() @Inject(HTTP_FETCH) fetchFn: FetchFunction | null) {
    this.fetchFn = fetchFn ?? fetch;
  }

  /**
   * Best-effort price for a fixed-value item by name, in the given league.
   * Returns the aggregate in exalted, or null when unknown/offline.
   */
  async priceByName(name: string, league: string): Promise<ListingPrice | null> {
    const trimmed = name.trim();
    const key = `${league}::${trimmed.toLowerCase()}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.price;
    let price: ListingPrice | null = null;
    try {
      price = await this.lookup(trimmed, league);
    } catch (error) {
      this.logger.debug(`poe2scout lookup failed for "${name}": ${errorMessage(error)}`);
    }
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { at: Date.now(), price });
    return price;
  }

  /**
   * The current temporary league per poe2scout (`IsCurrent`) — the fallback when
   * the operator has no watched searches to infer a league from (#18), so a
   * first-time user still prices against the live league, not config 'Standard'.
   * Best-effort: returns null on any failure and the caller falls back to config.
   */
  async currentLeague(): Promise<string | null> {
    const leagues = await this.leagues();
    const current = leagues.find((entry) => entry.isCurrent) ?? leagues[0];
    return current?.value ?? null;
  }

  /**
   * ApiId-keyed exchange rates for the league: GGG listing currency code
   * (`divine`, `mirror`, `chaos`, …) → CurrentPrice in exalted, across all
   * currency categories. ApiId == GGG code is evidenced (api-notes 2026-07-05),
   * which makes normalizing a listing price a direct lookup (D-dw-3). Same
   * 15-min TTL as the Text-keyed map — one fetch pass fills both. Best-effort:
   * null when no rates could be fetched (caller must treat the listing as
   * unpriceable, never as zero). Treat the returned map as read-only.
   */
  async currencyRatesByApiId(league: string): Promise<Map<string, number> | null> {
    const maps = await this.currencyMaps(league);
    return maps.pricesByApiId.size > 0 ? maps.pricesByApiId : null;
  }

  /**
   * The league's Divine Orb price in exalted, from `GET /Leagues` `DivinePrice`
   * (evidenced 2026-07-05: 714.3 in "Runes of Aldur"). Drives the
   * exalted↔divine display/threshold unit conversion (D-dw-11). Best-effort:
   * null when the league is unknown or the field is absent/non-positive.
   */
  async divinePriceExalted(league: string): Promise<number | null> {
    const leagues = await this.leagues();
    const target = league.toLowerCase();
    const match = leagues.find((entry) => entry.value.toLowerCase() === target);
    return match?.divinePriceExalted ?? null;
  }

  private async lookup(name: string, league: string): Promise<ListingPrice | null> {
    const currencyPrice = await this.currencyPrice(name, league);
    if (currencyPrice !== null) return { amount: currencyPrice, currency: 'exalted' };
    const itemPrice = await this.itemPrice(name, league);
    if (itemPrice !== null) return { amount: itemPrice, currency: 'exalted' };
    return null;
  }

  /** Unique/base price via the Items search endpoint (exact name match). */
  private async itemPrice(name: string, league: string): Promise<number | null> {
    const url = `${BASE_URL}/Leagues/${encodeURIComponent(league)}/Items?search=${encodeURIComponent(name)}&perPage=20&page=1`;
    const response = await this.fetchFn(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(POE2SCOUT_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as
      | Array<{ Name?: string; Text?: string; Type?: string; CurrentPrice?: number }>
      | { Items?: Array<{ Name?: string; Text?: string; CurrentPrice?: number }> };
    const items = Array.isArray(payload) ? payload : (payload.Items ?? []);
    const target = name.toLowerCase();
    const match = items.find(
      (item) =>
        (item.Name ?? '').toLowerCase() === target || (item.Text ?? '').toLowerCase() === target,
    );
    return typeof match?.CurrentPrice === 'number' && match.CurrentPrice > 0
      ? match.CurrentPrice
      : null;
  }

  /** Currency price via the per-league currency map (cached across categories). */
  private async currencyPrice(name: string, league: string): Promise<number | null> {
    const maps = await this.currencyMaps(league);
    return maps.pricesByText.get(name.toLowerCase()) ?? null;
  }

  private async currencyMaps(league: string): Promise<CurrencyPriceMaps> {
    const cached = this.currencyCache.get(league);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached;
    const pricesByText = new Map<string, number>();
    const pricesByApiId = new Map<string, number>();
    for (const category of CURRENCY_CATEGORIES) {
      try {
        const url = `${BASE_URL}/Leagues/${encodeURIComponent(league)}/Currencies/ByCategory?Category=${category}&perPage=300&page=1`;
        const response = await this.fetchFn(url, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(POE2SCOUT_TIMEOUT_MS),
        });
        if (!response.ok) continue;
        const payload = (await response.json()) as {
          Items?: Array<{ Text?: string; ApiId?: string; CurrentPrice?: number }>;
        };
        for (const item of payload.Items ?? []) {
          if (typeof item.CurrentPrice !== 'number') continue;
          if (typeof item.Text === 'string') {
            pricesByText.set(item.Text.toLowerCase(), item.CurrentPrice);
          }
          // A rate must be strictly positive to be usable as a conversion
          // factor — a zero/negative rate would silently price listings at 0.
          if (typeof item.ApiId === 'string' && item.CurrentPrice > 0) {
            pricesByApiId.set(item.ApiId, item.CurrentPrice);
          }
        }
      } catch (error) {
        this.logger.debug(`poe2scout currency ${category} failed: ${errorMessage(error)}`);
      }
    }
    const maps: CurrencyPriceMaps = { at: Date.now(), pricesByText, pricesByApiId };
    this.currencyCache.set(league, maps);
    return maps;
  }

  private async leagues(): Promise<Poe2ScoutLeague[]> {
    if (this.leaguesCache && Date.now() - this.leaguesCache.at < CACHE_TTL_MS) {
      return this.leaguesCache.leagues;
    }
    const leagues: Poe2ScoutLeague[] = [];
    try {
      const response = await this.fetchFn(`${BASE_URL}/Leagues`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(POE2SCOUT_TIMEOUT_MS),
      });
      if (response.ok) {
        const payload = (await response.json()) as
          | Array<RawPoe2ScoutLeague>
          | { Items?: Array<RawPoe2ScoutLeague> };
        const entries = Array.isArray(payload) ? payload : (payload.Items ?? []);
        for (const entry of entries) {
          if (typeof entry.Value !== 'string') continue;
          leagues.push({
            value: entry.Value,
            isCurrent: entry.IsCurrent === true,
            divinePriceExalted:
              typeof entry.DivinePrice === 'number' && entry.DivinePrice > 0
                ? entry.DivinePrice
                : null,
            baseCurrencyApiId:
              typeof entry.BaseCurrencyApiId === 'string' ? entry.BaseCurrencyApiId : null,
          });
        }
      }
    } catch (error) {
      this.logger.debug(`poe2scout leagues failed: ${errorMessage(error)}`);
    }
    // A failed fetch caches an empty list for the TTL — same posture the old
    // currentLeague cache had (null for TTL): degrade quietly, don't hammer.
    this.leaguesCache = { at: Date.now(), leagues };
    return leagues;
  }
}
