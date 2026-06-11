/**
 * Parsing for GGG's dynamic rate-limit headers. Format (observed 2026-06-11,
 * see docs/integration/api-notes.md):
 *
 *   X-Rate-Limit-Policy: trade-search-request-limit
 *   X-Rate-Limit-Rules:  Ip
 *   X-Rate-Limit-Ip:        8:10:60,15:60:120,60:300:1800   (max:period:restriction)
 *   X-Rate-Limit-Ip-State:  1:10:0,3:60:0,10:300:0          (hits:period:restricted)
 *
 * Values change server-side — never hardcode them.
 */

export interface RateLimitRule {
  maxHits: number;
  periodSeconds: number;
  restrictionSeconds: number;
}

export interface RateLimitSnapshot {
  policyName: string | null;
  rules: RateLimitRule[];
  /** Current usage in the same triplet shape (hits:period:restrictedSeconds). */
  states: RateLimitRule[];
}

export function parseRuleTriplets(headerValue: string): RateLimitRule[] {
  return headerValue
    .split(',')
    .map((triplet) => triplet.trim())
    .filter(Boolean)
    .map((triplet) => {
      const [maxHits, periodSeconds, restrictionSeconds] = triplet.split(':').map(Number);
      return {
        maxHits: maxHits ?? 0,
        periodSeconds: periodSeconds ?? 0,
        restrictionSeconds: restrictionSeconds ?? 0,
      };
    })
    .filter((rule) => Number.isFinite(rule.maxHits) && rule.periodSeconds > 0);
}

/** Reads a fetch Response's headers into a snapshot (null-safe on absence). */
export function parseRateLimitHeaders(headers: Headers): RateLimitSnapshot | null {
  const ruleNamesHeader = headers.get('x-rate-limit-rules');
  if (!ruleNamesHeader) return null;

  const rules: RateLimitRule[] = [];
  const states: RateLimitRule[] = [];
  for (const ruleName of ruleNamesHeader.split(',').map((name) => name.trim())) {
    const ruleHeader = headers.get(`x-rate-limit-${ruleName.toLowerCase()}`);
    const stateHeader = headers.get(`x-rate-limit-${ruleName.toLowerCase()}-state`);
    if (ruleHeader) rules.push(...parseRuleTriplets(ruleHeader));
    if (stateHeader) states.push(...parseRuleTriplets(stateHeader));
  }

  return {
    policyName: headers.get('x-rate-limit-policy'),
    rules,
    states,
  };
}

/**
 * True when any bucket sits at (or one hit below) its cap — the caller should
 * hold off for the bucket's period instead of risking a stacking lockout.
 */
export function isNearLimit(snapshot: RateLimitSnapshot): RateLimitRule | null {
  for (let index = 0; index < snapshot.states.length; index += 1) {
    const state = snapshot.states[index];
    const rule = snapshot.rules[index];
    if (!state || !rule) continue;
    if (state.maxHits >= rule.maxHits - 1) {
      return rule;
    }
  }
  return null;
}
