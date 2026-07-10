import { describe, expect, it, vi } from 'vitest';
import type { TradeApiClient } from '../trade-api/trade-api.client.js';
import { ExchangeRatesService } from './exchange-rates.service.js';

/** Build a payload in the evidenced exchange shape (api-notes 2026-07-10). */
function exchangePayload(
  offers: Array<{ giveCur: string; give: number; getCur: string; get: number; stock: number }>,
) {
  const result: Record<string, unknown> = {};
  offers.forEach((offer, index) => {
    result[`entry${index}`] = {
      listing: {
        offers: [
          {
            exchange: { currency: offer.giveCur, amount: offer.give },
            item: { currency: offer.getCur, amount: offer.get, stock: offer.stock },
          },
        ],
      },
    };
  });
  return { result };
}

/** The REAL order books observed live 2026-07-10 (Runes of Aldur), trimmed. */
const SELL_DIVINE_BOOK = exchangePayload([
  // Buyer pays divine, receives exalted — the real wall + the decoy tail.
  { giveCur: 'divine', give: 1, getCur: 'exalted', get: 500, stock: 13155 },
  { giveCur: 'divine', give: 1, getCur: 'exalted', get: 360, stock: 2623 },
  { giveCur: 'divine', give: 1, getCur: 'exalted', get: 350, stock: 613 },
  { giveCur: 'divine', give: 1, getCur: 'exalted', get: 321, stock: 1052 },
  { giveCur: 'divine', give: 19, getCur: 'exalted', get: 20, stock: 1127 },
  { giveCur: 'divine', give: 1, getCur: 'exalted', get: 1, stock: 6600 },
  { giveCur: 'divine', give: 1, getCur: 'exalted', get: 1, stock: 15 },
]);

const BUY_DIVINE_BOOK = exchangePayload([
  // Buyer pays exalted, receives divine — a tiny-stock bait then the real book.
  { giveCur: 'exalted', give: 5, getCur: 'divine', get: 1, stock: 7 },
  { giveCur: 'exalted', give: 550, getCur: 'divine', get: 1, stock: 135 },
  { giveCur: 'exalted', give: 590, getCur: 'divine', get: 1, stock: 10 },
  { giveCur: 'exalted', give: 650, getCur: 'divine', get: 1, stock: 10 },
]);

const BUY_CHAOS_BOOK = exchangePayload([
  { giveCur: 'exalted', give: 30, getCur: 'chaos', get: 1, stock: 200 },
  { giveCur: 'exalted', give: 33, getCur: 'chaos', get: 1, stock: 50 },
]);

function createService(
  route: (body: { query: { have: string[]; want: string[] } }) => {
    status: number;
    payload: unknown;
  },
) {
  const exchangePost = vi.fn((_realm: string, _league: string, body: unknown) => {
    const routed = route(body as { query: { have: string[]; want: string[] } });
    return Promise.resolve({ ...routed, rateHeaders: null });
  });
  const service = new ExchangeRatesService({ exchangePost } as unknown as TradeApiClient);
  return { service, exchangePost };
}

/** Routes the three production calls onto the observed books. */
function liveMarketRoute(body: { query: { have: string[]; want: string[] } }) {
  const [have] = body.query.have;
  const [want] = body.query.want;
  if (have === 'divine' && want === 'exalted') return { status: 200, payload: SELL_DIVINE_BOOK };
  if (have === 'exalted' && want === 'divine') return { status: 200, payload: BUY_DIVINE_BOOK };
  if (have === 'exalted' && want === 'chaos') return { status: 200, payload: BUY_CHAOS_BOOK };
  return { status: 404, payload: null };
}

describe('ExchangeRatesService', () => {
  it('derives the divine price as the mean of both stock-weighted side medians', async () => {
    const { service } = createService(liveMarketRoute);
    const rates = await service.ratesForLeague('poe2', 'League', 'cid');
    // Sell side: the 500@13155 wall dominates the weighted median despite the
    // 1:1@6600 decoy; buy side: 550 (the 5ex bait has stock 7). Mean = 525.
    expect(rates.divinePriceExalted).toBe(525);
    expect(rates.ratesByApiId?.get('divine')).toBe(525);
  });

  it('prices normalization currencies from the buy side (chaos)', async () => {
    const { service } = createService(liveMarketRoute);
    const rates = await service.ratesForLeague('poe2', 'League', 'cid');
    // Weighted median of 30@200 / 33@50 → 30.
    expect(rates.ratesByApiId?.get('chaos')).toBe(30);
  });

  it('caches per league — a second read spends no exchange budget', async () => {
    const { service, exchangePost } = createService(liveMarketRoute);
    await service.ratesForLeague('poe2', 'League', 'cid');
    const callsAfterFirst = exchangePost.mock.calls.length;
    await service.ratesForLeague('poe2', 'League', 'cid');
    expect(exchangePost.mock.calls.length).toBe(callsAfterFirst);
  });

  it('degrades to null rates when every call fails (never made-up numbers)', async () => {
    const { service } = createService(() => ({ status: 429, payload: null }));
    const rates = await service.ratesForLeague('poe2', 'League', 'cid');
    expect(rates.ratesByApiId).toBeNull();
    expect(rates.divinePriceExalted).toBeNull();
  });

  it('serves the last good snapshot through a later failed refresh', async () => {
    let healthy = true;
    const { service } = createService((body) =>
      healthy ? liveMarketRoute(body) : { status: 500, payload: null },
    );
    const first = await service.ratesForLeague('poe2', 'League', 'cid');
    expect(first.divinePriceExalted).toBe(525);
    // Age the cache past the TTL, then fail the upstream.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 16 * 60 * 1000);
      healthy = false;
      const second = await service.ratesForLeague('poe2', 'League', 'cid');
      expect(second.divinePriceExalted).toBe(525); // stale-good, not null
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores offers of the wrong pair or degenerate amounts', async () => {
    const { service } = createService((body) => {
      const [have] = body.query.have;
      if (have === 'divine') {
        return {
          status: 200,
          payload: exchangePayload([
            { giveCur: 'divine', give: 1, getCur: 'exalted', get: 500, stock: 100 },
            { giveCur: 'chaos', give: 1, getCur: 'exalted', get: 30, stock: 999 }, // wrong pair
            { giveCur: 'divine', give: 0, getCur: 'exalted', get: 100, stock: 5 }, // degenerate
          ]),
        };
      }
      return { status: 404, payload: null };
    });
    const rates = await service.ratesForLeague('poe2', 'League', 'cid');
    // Only the one valid sell-side sample survives → divine = 500 (single side).
    expect(rates.divinePriceExalted).toBe(500);
    expect(rates.ratesByApiId?.has('chaos')).toBe(false);
  });
});
