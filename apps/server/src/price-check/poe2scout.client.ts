import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { ListingPrice } from '@poe-sniper/shared';
import { errorMessage } from '../util/error-message.js';
import { FetchFunction, HTTP_FETCH } from '../trade-api/trade-api.client.js';

const BASE_URL = 'https://poe2scout.com/api';
/** Fixed-value prices barely move within a check session; cache generously. */
const CACHE_TTL_MS = 15 * 60 * 1000;
/** Bound the cache — insertion-order eviction keeps memory flat over a session. */
const CACHE_MAX_ENTRIES = 500;

interface CacheEntry {
  at: number;
  price: ListingPrice | null;
}

/**
 * Fixed-value item prices from the poe2scout aggregator (#37, D-pc-4).
 * NON-GGG host — never touches the trade rate-limit budget, so currency/runes/
 * uniques cost nothing on the detection side. Best-effort: any failure returns
 * null and the caller shows an "unpriced" state rather than erroring.
 */
@Injectable()
export class Poe2ScoutClient {
  private readonly logger = new Logger(Poe2ScoutClient.name);
  private readonly fetchFn: FetchFunction;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(@Optional() @Inject(HTTP_FETCH) fetchFn: FetchFunction | null) {
    this.fetchFn = fetchFn ?? fetch;
  }

  /**
   * Best-effort price for a fixed-value item by name. Returns the aggregate in
   * the poe2scout base currency (divine/exalted) or null when unknown/offline.
   */
  async priceByName(name: string): Promise<ListingPrice | null> {
    const key = name.trim().toLowerCase();
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.price;
    let price: ListingPrice | null = null;
    try {
      price = await this.lookup(key);
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

  private async lookup(name: string): Promise<ListingPrice | null> {
    // poe2scout exposes per-category item lists; the items search endpoint takes
    // a `search` param and returns entries with a currentPrice + currency.
    // TODO(verify): confirm the exact poe2scout endpoint + response shape against
    // the live API (docs/integration/api-notes.md). Best-effort by design — a
    // shape mismatch returns null (item shows "unpriced"), never throws.
    const url = `${BASE_URL}/items/search?search=${encodeURIComponent(name)}`;
    const response = await this.fetchFn(url, { headers: { accept: 'application/json' } });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      items?: Array<{ name?: string; text?: string; currentPrice?: number; currency?: string }>;
    };
    const match = (payload.items ?? []).find(
      (item) => (item.name ?? item.text ?? '').toLowerCase() === name,
    );
    if (!match || typeof match.currentPrice !== 'number') return null;
    return { amount: match.currentPrice, currency: match.currency ?? 'exalted' };
  }
}
