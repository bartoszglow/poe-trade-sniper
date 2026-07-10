import { Inject, Injectable, Logger } from '@nestjs/common';
import { errorMessage } from '../util/error-message.js';
import { TradeApiClient } from '../trade-api/trade-api.client.js';

/** One league's rate snapshot is served this long before a re-fetch. */
const CACHE_TTL_MS = 15 * 60 * 1000;
/** After a failed fetch round, retry no sooner than this (never hammer an outage). */
const FAILURE_RETRY_MS = 5 * 60 * 1000;
/** Result entries considered per direction — beyond these it's the decoy tail. */
const OFFER_SAMPLE = 10;
/**
 * Normalization-only currencies (listing prices → exalted), fetched buy-side
 * (one POST each). Divine is handled separately from BOTH market sides because
 * it is operator-facing (thresholds + display), not just normalization.
 */
const EXTRA_RATE_CURRENCIES = ['chaos'] as const;

/** The evidenced offer shape (api-notes § Currency Exchange, probed 2026-07-10). */
interface RawExchangeOffer {
  exchange?: { currency?: string; amount?: number };
  item?: { currency?: string; amount?: number; stock?: number };
}

interface RawExchangePayload {
  result?: Record<string, { listing?: { offers?: RawExchangeOffer[] } }>;
}

export interface LeagueRates {
  /** ApiId → exalted rate for the fetched currencies; null = nothing fetched. */
  ratesByApiId: Map<string, number> | null;
  /** Divine Orb price in exalted (mid of both market sides), or null. */
  divinePriceExalted: number | null;
}

interface CacheEntry {
  at: number;
  failed: boolean;
  rates: LeagueRates;
}

/** A rate observation: the implied exalted rate and the offer's stock weight. */
interface RateSample {
  rate: number;
  weight: number;
}

/**
 * Currency rates from GGG's OWN bulk Currency Exchange (D-dw-21) — replaces
 * poe2scout for deal-watch after its API vanished (404 on every route,
 * observed 2026-07-10). Exchange traffic runs through the TradeApiClient +
 * governor under its own GGG policy (`trade-exchange-request-limit`, separate
 * from search — evidenced), so rates never eat the detection budget.
 *
 * Estimator (probed evidence 2026-07-10): the offer book is full of decoys
 * (`1 div → 1 ex` at stock 6600 next to the real `1 div → 500 ex` wall at
 * stock 13155), so a plain median lies — each side uses a STOCK-WEIGHTED
 * median of the top offers instead, and the divine price is the mean of the
 * two sides (sell 500 / buy 550 → 525). Best-effort like poe2scout was: any
 * failure degrades to null ("unpriceable"), never to made-up numbers, and the
 * last good snapshot outlives a failed refresh.
 */
@Injectable()
export class ExchangeRatesService {
  private readonly logger = new Logger(ExchangeRatesService.name);
  private readonly cache = new Map<string, CacheEntry>();
  /** Last non-null snapshot per league — served when a refresh round fails. */
  private readonly lastGood = new Map<string, LeagueRates>();
  /** Single-flight per league — concurrent baselines share one fetch round. */
  private readonly inFlight = new Map<string, Promise<LeagueRates>>();

  constructor(@Inject(TradeApiClient) private readonly tradeApi: TradeApiClient) {}

  /** The league's rate snapshot (cached). Never throws. */
  async ratesForLeague(realm: string, league: string, correlationId: string): Promise<LeagueRates> {
    const key = `${realm}::${league}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < (cached.failed ? FAILURE_RETRY_MS : CACHE_TTL_MS)) {
      return cached.rates;
    }
    const running = this.inFlight.get(key);
    if (running) return running;
    const fetchRound = this.fetchRates(realm, league, correlationId).finally(() =>
      this.inFlight.delete(key),
    );
    this.inFlight.set(key, fetchRound);
    return fetchRound;
  }

  private async fetchRates(
    realm: string,
    league: string,
    correlationId: string,
  ): Promise<LeagueRates> {
    const key = `${realm}::${league}`;
    const ratesByApiId = new Map<string, number>();

    // Divine from BOTH sides of the book (operator-facing number): the mean of
    // the sell-side and buy-side weighted medians brackets the spread.
    const sellSide = await this.sideMedian(realm, league, 'divine', 'sell', correlationId);
    const buySide = await this.sideMedian(realm, league, 'divine', 'buy', correlationId);
    const divineSides = [sellSide, buySide].filter(
      (value): value is number => value !== null && value > 0,
    );
    const divinePriceExalted =
      divineSides.length > 0
        ? divineSides.reduce((sum, value) => sum + value, 0) / divineSides.length
        : null;
    if (divinePriceExalted !== null) ratesByApiId.set('divine', divinePriceExalted);

    // Normalization-only currencies: buy-side is enough (decoys there are
    // tiny-stock underbids the weighted median shrugs off).
    for (const currency of EXTRA_RATE_CURRENCIES) {
      const rate = await this.sideMedian(realm, league, currency, 'buy', correlationId);
      if (rate !== null && rate > 0) ratesByApiId.set(currency, rate);
    }

    const failed = ratesByApiId.size === 0;
    const rates: LeagueRates = failed
      ? (this.lastGood.get(key) ?? { ratesByApiId: null, divinePriceExalted: null })
      : { ratesByApiId, divinePriceExalted };
    if (!failed) this.lastGood.set(key, rates);
    this.cache.set(key, { at: Date.now(), failed, rates });
    if (failed) this.logger.warn(`exchange rates unavailable for ${league} (serving last good)`);
    return rates;
  }

  /**
   * One exchange POST for one side of one currency's book, reduced to the
   * stock-weighted median exalted rate (null on any failure / empty book).
   * sell = we give `currency`, receive exalted; buy = we give exalted.
   */
  private async sideMedian(
    realm: string,
    league: string,
    currency: string,
    side: 'sell' | 'buy',
    correlationId: string,
  ): Promise<number | null> {
    const [have, want] = side === 'sell' ? [currency, 'exalted'] : ['exalted', currency];
    try {
      const { status, payload } = await this.tradeApi.exchangePost(
        realm,
        league,
        {
          query: { status: { option: 'online' }, have: [have], want: [want] },
          sort: { have: 'asc' },
          engine: 'new',
        },
        correlationId,
      );
      if (status !== 200) {
        this.logger.debug(`exchange ${side} ${currency} HTTP ${status}`);
        return null;
      }
      return weightedMedian(collectSamples(payload as RawExchangePayload, currency, side));
    } catch (error) {
      this.logger.debug(`exchange ${side} ${currency} failed: ${errorMessage(error)}`);
      return null;
    }
  }
}

/** Pull (rate, stock-weight) samples for the currency pair out of a payload. */
function collectSamples(
  payload: RawExchangePayload,
  currency: string,
  side: 'sell' | 'buy',
): RateSample[] {
  const samples: RateSample[] = [];
  const entries = Object.values(payload.result ?? {}).slice(0, OFFER_SAMPLE);
  for (const entry of entries) {
    for (const offer of entry.listing?.offers ?? []) {
      const give = offer.exchange;
      const receive = offer.item;
      if (
        typeof give?.amount !== 'number' ||
        give.amount <= 0 ||
        typeof receive?.amount !== 'number' ||
        receive.amount <= 0
      ) {
        continue;
      }
      // sell: give currency → receive exalted; buy: give exalted → receive currency.
      const pairMatches =
        side === 'sell'
          ? give.currency === currency && receive.currency === 'exalted'
          : give.currency === 'exalted' && receive.currency === currency;
      if (!pairMatches) continue;
      const rate = side === 'sell' ? receive.amount / give.amount : give.amount / receive.amount;
      const weight = typeof receive.stock === 'number' && receive.stock > 0 ? receive.stock : 1;
      if (Number.isFinite(rate) && rate > 0) samples.push({ rate, weight });
    }
  }
  return samples;
}

/** Stock-weighted median: sort by rate, take the rate at half the total weight. */
function weightedMedian(samples: RateSample[]): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((left, right) => left.rate - right.rate);
  const totalWeight = sorted.reduce((sum, sample) => sum + sample.weight, 0);
  let cumulative = 0;
  for (const sample of sorted) {
    cumulative += sample.weight;
    if (cumulative >= totalWeight / 2) return sample.rate;
  }
  return sorted[sorted.length - 1]?.rate ?? null;
}
