import { describe, expect, it } from 'vitest';
import type { DealWatchStatusCode } from '@poe-sniper/shared';
import {
  DEAL_DOT_CLASSES,
  DEAL_PATCH_ERROR_KEYS,
  DEAL_STATUS_DISPLAY,
  computeClientCutoffExalted,
  dealQueryPinsItem,
  formatDealThresholdChip,
  formatExaltedAmount,
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

describe('exalted amount formatters', () => {
  it('appends the exalted suffix with price rounding', () => {
    expect(formatExaltedAmount(736.9231)).toBe('737 ex');
    expect(formatExaltedAmount(5)).toBe('5 ex');
  });

  it('signs trend deltas and neutralizes a rounded-to-zero delta', () => {
    expect(formatSignedExaltedAmount(12)).toBe('+12 ex');
    expect(formatSignedExaltedAmount(-8.4)).toBe('−8.4 ex');
    expect(formatSignedExaltedAmount(0)).toBe('0 ex');
    expect(formatSignedExaltedAmount(-0.001)).toBe('0 ex');
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

  it('returns null for absolute-divine (the server owns the live rate)', () => {
    expect(
      computeClientCutoffExalted({ mode: 'absolute', thresholdValue: 5, unit: 'divine' }, 500),
    ).toBeNull();
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
