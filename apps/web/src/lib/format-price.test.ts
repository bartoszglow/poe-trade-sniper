import { describe, expect, it } from 'vitest';
import { formatPriceAmount } from './format-price';

describe('formatPriceAmount', () => {
  it('rounds large aggregate fractions to a whole number', () => {
    expect(formatPriceAmount(736.9231)).toBe('737');
  });

  it('keeps one decimal in the tens and two below ten, stripping trailing zeros', () => {
    expect(formatPriceAmount(20.54)).toBe('20.5');
    expect(formatPriceAmount(2.333)).toBe('2.33');
    expect(formatPriceAmount(5)).toBe('5');
    expect(formatPriceAmount(5.0)).toBe('5');
  });

  it('handles zero and negatives by magnitude', () => {
    expect(formatPriceAmount(0)).toBe('0');
    expect(formatPriceAmount(-736.9231)).toBe('-737');
  });

  it('passes non-finite values through as-is', () => {
    expect(formatPriceAmount(Number.POSITIVE_INFINITY)).toBe('Infinity');
    expect(formatPriceAmount(Number.NaN)).toBe('NaN');
  });
});
