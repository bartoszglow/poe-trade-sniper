import { describe, expect, it } from 'vitest';
import type { DealHitInfo } from '@poe-sniper/shared';
import { interpolate } from '../i18n/i18n';
import { EN, type MessageKey } from '../i18n/messages';
import {
  composeDealContext,
  composeDealNotification,
  feedKindForHit,
  formatDealDiscount,
  formatListedPrice,
  type DealTranslator,
} from './deal-display';

/** Test translator over the REAL EN catalog — validates the actual templates. */
const translate: DealTranslator = (key: MessageKey, vars) => interpolate(EN[key], vars);

function makeDeal(overrides: Partial<DealHitInfo> = {}): DealHitInfo {
  return {
    baselineExalted: 516,
    discountPercent: 32,
    discountExalted: 156,
    baselineStale: false,
    ...overrides,
  };
}

const PENDING_DEAL: DealHitInfo = {
  baselineExalted: null,
  discountPercent: null,
  discountExalted: null,
  baselineStale: false,
};

describe('formatDealDiscount', () => {
  it('renders a typographic-minus whole percent', () => {
    expect(formatDealDiscount(makeDeal({ discountPercent: 32 }))).toBe('−32%');
  });

  it('rounds fractional percents', () => {
    expect(formatDealDiscount(makeDeal({ discountPercent: 32.6 }))).toBe('−33%');
  });

  it('flips sign display for a negative discount (listed above baseline)', () => {
    expect(formatDealDiscount(makeDeal({ discountPercent: -3.2 }))).toBe('+3%');
  });

  it('is null without a baseline', () => {
    expect(formatDealDiscount(PENDING_DEAL)).toBeNull();
  });
});

describe('formatListedPrice', () => {
  it('formats amount + currency', () => {
    expect(formatListedPrice({ amount: 360, currency: 'exalted' }, translate)).toBe('360 exalted');
  });

  it('falls back to the localized no-price label', () => {
    expect(formatListedPrice(null, translate)).toBe(EN['item.noPrice']);
  });
});

describe('composeDealContext', () => {
  it('composes the full flip context', () => {
    expect(composeDealContext({ amount: 360, currency: 'exalted' }, makeDeal(), translate)).toBe(
      'listed 360 exalted · resale ≈ 516 ex (+156 ex)',
    );
  });

  it('signs a negative margin honestly', () => {
    expect(
      composeDealContext(
        { amount: 528, currency: 'exalted' },
        makeDeal({ discountExalted: -12, discountPercent: -2 }),
        translate,
      ),
    ).toBe('listed 528 exalted · resale ≈ 516 ex (−12 ex)');
  });

  it('uses the pending variant when the baseline was missing', () => {
    expect(composeDealContext({ amount: 5, currency: 'divine' }, PENDING_DEAL, translate)).toBe(
      interpolate(EN['deal.contextPending'], { price: '5 divine' }),
    );
  });
});

describe('composeDealNotification', () => {
  it('builds the DEAL title with the discount and the flip-context body', () => {
    const { title, body } = composeDealNotification(
      'Headhunter',
      { amount: 360, currency: 'exalted' },
      makeDeal(),
      translate,
    );
    expect(title).toBe('DEAL −32% · Headhunter');
    expect(body).toBe('listed 360 exalted · resale ≈ 516 ex (+156 ex)');
  });

  it('uses the no-discount title variant without a baseline', () => {
    const { title } = composeDealNotification('Headhunter', null, PENDING_DEAL, translate);
    expect(title).toBe(interpolate(EN['notify.dealTitlePending'], { item: 'Headhunter' }));
  });
});

describe('feedKindForHit', () => {
  it("maps a deal-carrying hit to 'deal'", () => {
    expect(feedKindForHit({ deal: makeDeal() })).toBe('deal');
  });

  it("maps a pending-discount deal (all-null fields) to 'deal'", () => {
    expect(feedKindForHit({ deal: PENDING_DEAL })).toBe('deal');
  });

  it("maps ordinary hits (null or absent deal) to 'hit'", () => {
    expect(feedKindForHit({ deal: null })).toBe('hit');
    expect(feedKindForHit({})).toBe('hit');
  });
});
