import { describe, expect, it } from 'vitest';
import { parseQueryCriteria } from './query-criteria';

/** The deal-mode auto-cap shape: an option-less exalted max (plan 41 D-dw-6). */
function autoCapQuery(maxExalted: number): unknown {
  return {
    type: 'Twister',
    filters: { trade_filters: { filters: { price: { max: maxExalted } } } },
  };
}

describe('parseQueryCriteria — price formatting', () => {
  it('shows an option-less bound raw when no divine rate is supplied', () => {
    const parsed = parseQueryCriteria(autoCapQuery(18768), null);
    expect(parsed.price).toBe('≤ 18768');
  });

  it('renders an option-less cap divine-aware when a rate is supplied', () => {
    // 18768 ex / 714 ≈ 26.3 div — the readable deal-mode display.
    const parsed = parseQueryCriteria(autoCapQuery(18768), null, 714);
    expect(parsed.price).toBe('≤ 26.3 div (18768 ex)');
  });

  it('keeps a sub-divine cap in exalted even with a rate', () => {
    const parsed = parseQueryCriteria(autoCapQuery(500), null, 714);
    expect(parsed.price).toBe('≤ 500 ex');
  });

  it('leaves an explicit-currency price untouched by the rate (operator search)', () => {
    const query = {
      type: 'Twister',
      filters: { trade_filters: { filters: { price: { max: 25, option: 'divine' } } } },
    };
    const parsed = parseQueryCriteria(query, null, 714);
    expect(parsed.price).toBe('≤ 25 divine');
  });
});
