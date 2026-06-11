import { describe, expect, it } from 'vitest';
import { isNearLimit, parseRateLimitHeaders, parseRuleTriplets } from './rate-limit-headers.js';

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

describe('isNearLimit', () => {
  const rules = [
    { maxHits: 8, periodSeconds: 10, restrictionSeconds: 60 },
    { maxHits: 60, periodSeconds: 300, restrictionSeconds: 1800 },
  ];

  it('flags a bucket one hit below its cap', () => {
    const crowded = isNearLimit({
      policyName: 'p',
      rules,
      states: [
        { maxHits: 7, periodSeconds: 10, restrictionSeconds: 0 },
        { maxHits: 10, periodSeconds: 300, restrictionSeconds: 0 },
      ],
    });
    expect(crowded).toEqual(rules[0]);
  });

  it('stays quiet with headroom everywhere', () => {
    const crowded = isNearLimit({
      policyName: 'p',
      rules,
      states: [
        { maxHits: 2, periodSeconds: 10, restrictionSeconds: 0 },
        { maxHits: 10, periodSeconds: 300, restrictionSeconds: 0 },
      ],
    });
    expect(crowded).toBeNull();
  });
});
