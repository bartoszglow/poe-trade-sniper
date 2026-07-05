import { describe, expect, it } from 'vitest';
import {
  effectiveCap,
  isNearLimit,
  parseRateLimitHeaders,
  parseRuleTriplets,
} from './rate-limit-headers.js';

describe('parseRuleTriplets', () => {
  it('parses the observed search policy shape', () => {
    expect(parseRuleTriplets('8:10:60,15:60:120,60:300:1800')).toEqual([
      { maxHits: 8, periodSeconds: 10, restrictionSeconds: 60 },
      { maxHits: 15, periodSeconds: 60, restrictionSeconds: 120 },
      { maxHits: 60, periodSeconds: 300, restrictionSeconds: 1800 },
    ]);
  });

  it('drops malformed triplets', () => {
    expect(parseRuleTriplets('garbage,8:10:60')).toEqual([
      { maxHits: 8, periodSeconds: 10, restrictionSeconds: 60 },
    ]);
  });
});

describe('parseRateLimitHeaders', () => {
  it('reads policy, rules and state for each rule name', () => {
    const headers = new Headers({
      'X-Rate-Limit-Policy': 'trade-search-request-limit',
      'X-Rate-Limit-Rules': 'Ip',
      'X-Rate-Limit-Ip': '8:10:60,60:300:1800',
      'X-Rate-Limit-Ip-State': '2:10:0,11:300:0',
    });
    expect(parseRateLimitHeaders(headers)).toEqual({
      policyName: 'trade-search-request-limit',
      rules: [
        { maxHits: 8, periodSeconds: 10, restrictionSeconds: 60 },
        { maxHits: 60, periodSeconds: 300, restrictionSeconds: 1800 },
      ],
      states: [
        { maxHits: 2, periodSeconds: 10, restrictionSeconds: 0 },
        { maxHits: 11, periodSeconds: 300, restrictionSeconds: 0 },
      ],
    });
  });

  it('returns null when no rate-limit headers are present', () => {
    expect(parseRateLimitHeaders(new Headers())).toBeNull();
  });
});

describe('effectiveCap', () => {
  it('scales GGG’s cap by the aggressiveness %, flooring, floored at 1', () => {
    expect(effectiveCap(20, 50)).toBe(10);
    expect(effectiveCap(20, 85)).toBe(17);
    expect(effectiveCap(20, 100)).toBe(20);
    expect(effectiveCap(20, 120)).toBe(24);
    expect(effectiveCap(1, 50)).toBe(1); // never floors a real bucket to zero
  });

  it('leaves ≥1 hit of margin on a tight bucket at a sub-100 default (review S3)', () => {
    // The Account rule cap is 3. round(3×0.85)=3 = the raw cap → zero margin,
    // less conservative than the retired cap−1. Floor gives 2 — real margin.
    expect(effectiveCap(3, 85)).toBe(2);
    expect(effectiveCap(3, 100)).toBe(3); // at 100 we do run right at the cap
  });
});

describe('isNearLimit', () => {
  const rules = [
    { maxHits: 8, periodSeconds: 10, restrictionSeconds: 60 },
    { maxHits: 60, periodSeconds: 300, restrictionSeconds: 1800 },
  ];
  const stateAt = (first: number, second: number) => [
    { maxHits: first, periodSeconds: 10, restrictionSeconds: 0 },
    { maxHits: second, periodSeconds: 300, restrictionSeconds: 0 },
  ];

  it('at A=100 flags a bucket that has reached GGG’s raw cap', () => {
    expect(isNearLimit({ policyName: 'p', rules, states: stateAt(8, 10) }, 100)).toEqual(rules[0]);
    // one below the cap is still clear at 100
    expect(isNearLimit({ policyName: 'p', rules, states: stateAt(7, 10) }, 100)).toBeNull();
  });

  it('at A=85 flags earlier — the effective ceiling of an 8-cap bucket is 7', () => {
    expect(isNearLimit({ policyName: 'p', rules, states: stateAt(7, 10) }, 85)).toEqual(rules[0]);
  });

  it('at A=120 (risk zone) stays quiet even at the raw cap', () => {
    // effectiveCap(8,120)=10 > 8 — never holds; the 429 path is the only brake.
    expect(isNearLimit({ policyName: 'p', rules, states: stateAt(8, 10) }, 120)).toBeNull();
  });

  it('stays quiet with headroom everywhere', () => {
    expect(isNearLimit({ policyName: 'p', rules, states: stateAt(2, 10) }, 100)).toBeNull();
  });
});
