import { describe, expect, it } from 'vitest';
import type { DealWatchState, DealWatchStatusCode } from '@poe-sniper/shared';
import {
  DEAL_DOT_CLASSES,
  DEAL_PATCH_ERROR_KEYS,
  DEAL_STATUS_DISPLAY,
  computeClientCutoffExalted,
  cutoffExaltedForState,
  dealQueryPinsItem,
  formatDealCutoffChip,
  formatDealThresholdChip,
  formatExaltedAmount,
  formatExaltedDetailed,
  formatSignedExaltedAmount,
} from './deal-watch-display';

const ALL_STATUS_CODES: DealWatchStatusCode[] = [
  'active',
  'paused',
  'pending-derive',
  'insufficient-data',
  'baseline-stale',
  'derive-failed',
  'derive-conflict',
  'derived-expired',
  'unsupported-item',
  'capped',
  'restore-pending',
  'restore-failed',
];

describe('DEAL_STATUS_DISPLAY', () => {
  it('maps every status code to its existing catalog key and a dot class', () => {
    for (const statusCode of ALL_STATUS_CODES) {
      const display = DEAL_STATUS_DISPLAY[statusCode];
      expect(display.labelKey).toBe(`dealWatch.status.${statusCode}`);
      expect(DEAL_DOT_CLASSES[display.dotState]).toMatch(/^bg-/);
    }
  });

  it('signals hard failures as danger and recoverable states as warn/info', () => {
    expect(DEAL_STATUS_DISPLAY['active'].tone).toBe('ok');
    expect(DEAL_STATUS_DISPLAY['derive-failed'].tone).toBe('danger');
    expect(DEAL_STATUS_DISPLAY['restore-failed'].tone).toBe('danger');
    expect(DEAL_STATUS_DISPLAY['baseline-stale'].tone).toBe('warn');
    expect(DEAL_STATUS_DISPLAY['pending-derive'].tone).toBe('info');
  });
});

describe('formatDealThresholdChip', () => {
  it('formats percent mode with a minus sign regardless of unit', () => {
    expect(formatDealThresholdChip('percent', 30, 'exalted')).toBe('−30%');
    expect(formatDealThresholdChip('percent', 12.5, 'divine')).toBe('−12.5%');
  });

  it('formats absolute mode with the unit suffix', () => {
    expect(formatDealThresholdChip('absolute', 5, 'divine')).toBe('−5 div');
    expect(formatDealThresholdChip('absolute', 12, 'exalted')).toBe('−12 ex');
  });

  it('rounds threshold amounts by magnitude like listing prices', () => {
    expect(formatDealThresholdChip('absolute', 736.9231, 'exalted')).toBe('−737 ex');
  });
});

describe('formatDealCutoffChip', () => {
  it('renders the buy-below price with a "<" prefix, divine-aware', () => {
    expect(formatDealCutoffChip(53421, 714.3)).toBe('< 74.8 div');
    expect(formatDealCutoffChip(516, 714.3)).toBe('< 516 ex');
    expect(formatDealCutoffChip(516, null)).toBe('< 516 ex');
  });
});

describe('exalted amount formatters', () => {
  it('appends the exalted suffix with price rounding when no rate is known', () => {
    expect(formatExaltedAmount(736.9231, null)).toBe('737 ex');
    expect(formatExaltedAmount(5, null)).toBe('5 ex');
  });

  it('switches to divine at or above one divine (operator readability request)', () => {
    expect(formatExaltedAmount(53421, 714.3)).toBe('74.8 div');
    expect(formatExaltedAmount(714.3, 714.3)).toBe('1 div');
    expect(formatExaltedAmount(713, 714.3)).toBe('713 ex');
    expect(formatExaltedAmount(1428.6, 714.3)).toBe('2 div');
  });

  it('never divides by a degenerate rate', () => {
    expect(formatExaltedAmount(53421, 0)).toBe('53.4k ex');
    expect(formatExaltedAmount(53421, -5)).toBe('53.4k ex');
  });

  it('pairs the divine primary with the exact exalted secondary', () => {
    expect(formatExaltedDetailed(53421, 714.3)).toEqual({
      primary: '74.8 div',
      secondary: '53.4k ex',
    });
    expect(formatExaltedDetailed(516, 714.3)).toEqual({ primary: '516 ex', secondary: null });
    expect(formatExaltedDetailed(53421, null)).toEqual({ primary: '53.4k ex', secondary: null });
  });

  it('rounds exalted thousands to k with a trimmed decimal (operator request)', () => {
    expect(formatExaltedAmount(999, null)).toBe('999 ex');
    expect(formatExaltedAmount(1000, null)).toBe('1k ex');
    expect(formatExaltedAmount(1049, null)).toBe('1k ex');
    expect(formatExaltedAmount(1140, null)).toBe('1.1k ex');
    expect(formatExaltedAmount(52660, null)).toBe('52.7k ex');
    expect(formatSignedExaltedAmount(1140, null)).toBe('+1.1k ex');
  });

  it('signs trend deltas and neutralizes a rounded-to-zero delta', () => {
    expect(formatSignedExaltedAmount(12, null)).toBe('+12 ex');
    expect(formatSignedExaltedAmount(-8.4, null)).toBe('−8.4 ex');
    expect(formatSignedExaltedAmount(0, null)).toBe('0 ex');
    expect(formatSignedExaltedAmount(-0.001, null)).toBe('0 ex');
  });

  it('signs divine-magnitude deltas in divine', () => {
    expect(formatSignedExaltedAmount(1500, 714.3)).toBe('+2.1 div');
    expect(formatSignedExaltedAmount(-1500, 714.3)).toBe('−2.1 div');
    expect(formatSignedExaltedAmount(500, 714.3)).toBe('+500 ex');
  });
});

describe('computeClientCutoffExalted', () => {
  it('computes the percent cutoff from the baseline', () => {
    expect(
      computeClientCutoffExalted({ mode: 'percent', thresholdValue: 30, unit: 'exalted' }, 500),
    ).toBe(350);
  });

  it('computes the absolute-exalted cutoff by subtraction', () => {
    expect(
      computeClientCutoffExalted({ mode: 'absolute', thresholdValue: 120, unit: 'exalted' }, 500),
    ).toBe(380);
  });

  it('floors degenerate cutoffs at zero instead of going negative', () => {
    expect(
      computeClientCutoffExalted({ mode: 'absolute', thresholdValue: 900, unit: 'exalted' }, 500),
    ).toBe(0);
  });

  it('returns null without a baseline', () => {
    expect(
      computeClientCutoffExalted({ mode: 'percent', thresholdValue: 30, unit: 'exalted' }, null),
    ).toBeNull();
  });

  it('computes the absolute-divine cutoff from the divine rate (baseline − threshold×rate)', () => {
    // The reported bug: baseline 699 div, threshold 30 div → buy-below 669 div,
    // NOT the 836-div GGG filter cap. In exalted at a 505 rate:
    expect(
      computeClientCutoffExalted(
        { mode: 'absolute', thresholdValue: 30, unit: 'divine' },
        353_050,
        505,
      ),
    ).toBe(353_050 - 30 * 505); // 337_900 ex — strictly BELOW the 353_050 baseline
  });

  it('returns null for absolute-divine only when the rate is unknown', () => {
    expect(
      computeClientCutoffExalted(
        { mode: 'absolute', thresholdValue: 5, unit: 'divine' },
        500,
        null,
      ),
    ).toBeNull();
  });
});

describe('cutoffExaltedForState', () => {
  // cutoffExaltedForState reads only mode/thresholdValue/unit/baseline/divineRate.
  function dealState(overrides: Partial<DealWatchState>): DealWatchState {
    return {
      mode: 'absolute',
      thresholdValue: 30,
      unit: 'divine',
      baseline: { amountExalted: 353_050 } as DealWatchState['baseline'],
      divinePriceExalted: 505,
      capExalted: 422_306, // the WRONG value the chip used to show (≈ cutoff × 1.25 — the GGG filter cap, above baseline)
      ...overrides,
    } as DealWatchState;
  }

  it('is the deal cutoff (baseline − threshold), NOT capExalted (plan 46 regression)', () => {
    const cutoff = cutoffExaltedForState(dealState({}));
    expect(cutoff).toBe(353_050 - 30 * 505); // 337_900 — the true buy-below
    // The bug was showing capExalted (422_306), which is ABOVE the baseline.
    expect(cutoff).toBeLessThan(353_050);
    expect(cutoff).not.toBe(422_306);
  });

  it('computes a percent cutoff without needing a rate', () => {
    expect(cutoffExaltedForState(dealState({ mode: 'percent', thresholdValue: 20 }))).toBe(
      353_050 * 0.8,
    );
  });

  it('is null before the first baseline lands', () => {
    expect(cutoffExaltedForState(dealState({ baseline: null }))).toBeNull();
  });

  it('is null for a divine threshold when the rate is unknown', () => {
    expect(cutoffExaltedForState(dealState({ divinePriceExalted: null }))).toBeNull();
  });
});

describe('dealQueryPinsItem', () => {
  it('accepts a pinned name or type (string or option shape)', () => {
    expect(dealQueryPinsItem({ name: 'Headhunter' })).toBe(true);
    expect(dealQueryPinsItem({ type: { option: 'Heavy Belt' } })).toBe(true);
  });

  it('rejects queries pinning neither name nor type', () => {
    expect(dealQueryPinsItem({ term: 'belt' })).toBe(false);
    expect(
      dealQueryPinsItem({
        filters: { type_filters: { filters: { category: { option: 'belt' } } } },
      }),
    ).toBe(false);
    expect(dealQueryPinsItem(null)).toBe(false);
    expect(dealQueryPinsItem(undefined)).toBe(false);
  });
});

describe('DEAL_PATCH_ERROR_KEYS', () => {
  it('maps the coded PATCH 409 refusals to their catalog messages', () => {
    expect(DEAL_PATCH_ERROR_KEYS['deal-unsupported-item']).toBe(
      'dealWatch.status.unsupported-item',
    );
    expect(DEAL_PATCH_ERROR_KEYS['deal-capped']).toBe('dealWatch.status.capped');
  });

  it('leaves unknown codes unmapped so the UI falls back to the generic failure', () => {
    expect(DEAL_PATCH_ERROR_KEYS['deal-something-new']).toBeUndefined();
  });
});
