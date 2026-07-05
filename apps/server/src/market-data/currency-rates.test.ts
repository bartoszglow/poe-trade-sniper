import { describe, expect, it } from 'vitest';
import { convertToExalted, exaltedToUnit, unitToExalted } from './currency-rates.js';

const RATES = new Map<string, number>([
  ['divine', 714.3],
  ['chaos', 93.3],
]);

describe('convertToExalted', () => {
  it('short-circuits exalted without touching the rate map', () => {
    expect(convertToExalted(42, 'exalted', null)).toBe(42);
  });

  it('multiplies by the ApiId rate', () => {
    expect(convertToExalted(2, 'divine', RATES)).toBeCloseTo(1428.6);
  });

  it('yields null (unpriceable, never zero) for an unknown code or missing map', () => {
    expect(convertToExalted(99, 'waystone-10', RATES)).toBeNull();
    expect(convertToExalted(1, 'divine', null)).toBeNull();
  });
});

describe('unitToExalted / exaltedToUnit (D-dw-11)', () => {
  it('exalted unit is the identity in both directions', () => {
    expect(unitToExalted(5, 'exalted', null)).toBe(5);
    expect(exaltedToUnit(5, 'exalted', null)).toBe(5);
  });

  it('divine unit converts via the live DivinePrice snapshot', () => {
    expect(unitToExalted(5, 'divine', 714.3)).toBeCloseTo(3571.5);
    expect(exaltedToUnit(3571.5, 'divine', 714.3)).toBeCloseTo(5);
  });

  it('divine unit without a rate is unpriceable, not zero', () => {
    expect(unitToExalted(5, 'divine', null)).toBeNull();
    expect(exaltedToUnit(5, 'divine', null)).toBeNull();
    expect(exaltedToUnit(5, 'divine', 0)).toBeNull();
  });
});
