import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AppSettings, DEFAULT_APP_SETTINGS } from '@poe-sniper/shared';
import type { AppSettingsService } from '../settings/app-settings.service.js';
import { RateLimitGovernor } from './rate-limit-governor.js';

/**
 * A minimal AppSettingsService stub — the governor only reads
 * `get().rateLimitAggressiveness`. Mutating the returned settings object between
 * calls proves the governor reads it LIVE (D-dw-19, no restart).
 */
function stubSettings(rateLimitAggressiveness = 100): {
  service: AppSettingsService;
  settings: AppSettings;
} {
  const settings: AppSettings = { ...DEFAULT_APP_SETTINGS, rateLimitAggressiveness };
  const service = { get: () => settings } as unknown as AppSettingsService;
  return { service, settings };
}

const searchHeaders = (rule: string, state: string): Headers =>
  new Headers({
    'X-Rate-Limit-Rules': 'Ip',
    'X-Rate-Limit-Ip': rule,
    'X-Rate-Limit-Ip-State': state,
  });

describe('RateLimitGovernor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('spaces consecutive acquisitions of the same policy', async () => {
    const governor = new RateLimitGovernor(stubSettings().service);
    const order: number[] = [];

    const first = governor.acquire('fetch', 600).then(() => order.push(Date.now()));
    const second = governor.acquire('fetch', 600).then(() => order.push(Date.now()));

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(600);
    await Promise.all([first, second]);

    expect(order[1]! - order[0]!).toBeGreaterThanOrEqual(600);
  });

  it('does not couple unrelated policies', async () => {
    const governor = new RateLimitGovernor(stubSettings().service);
    await governor.acquire('search', 1_000);

    let fetchAcquired = false;
    const fetchAcquire = governor.acquire('fetch', 1_000).then(() => {
      fetchAcquired = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    await fetchAcquire;
    expect(fetchAcquired).toBe(true);
  });

  it('a 429 pauses every policy for Retry-After', async () => {
    const governor = new RateLimitGovernor(stubSettings().service);
    governor.noteResponse('search', 429, new Headers({ 'Retry-After': '30' }));

    let acquired = false;
    const pending = governor.acquire('fetch', 0).then(() => {
      acquired = true;
    });

    await vi.advanceTimersByTimeAsync(29_000);
    expect(acquired).toBe(false);
    await vi.advanceTimersByTimeAsync(1_100);
    await pending;
    expect(acquired).toBe(true);
  });

  it('a 429 with a malformed/HTTP-date Retry-After still engages a finite 60s lockout', async () => {
    const governor = new RateLimitGovernor(stubSettings().service);
    // HTTP-date form → Number(...) is NaN; must fall back to 60s, never vanish.
    governor.noteResponse(
      'search',
      429,
      new Headers({ 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' }),
    );
    expect(governor.status.pausedUntil).not.toBeNull(); // pause engaged, not NaN-dropped

    let acquired = false;
    const pending = governor.acquire('fetch', 0).then(() => {
      acquired = true;
    });
    await vi.advanceTimersByTimeAsync(59_000);
    expect(acquired).toBe(false); // still locked under the 60s fallback
    await vi.advanceTimersByTimeAsync(1_100);
    await pending;
    expect(acquired).toBe(true);
    expect(governor.status.pausedUntil).toBeNull(); // and it cleanly expires
  });

  it('holds a policy whose bucket reaches the effective ceiling (A=100 = raw cap)', async () => {
    const governor = new RateLimitGovernor(stubSettings(100).service);
    // At aggressiveness 100 the effective ceiling IS GGG's cap (8); a bucket at
    // 8/8 must hold for the period.
    governor.noteResponse('search', 200, searchHeaders('8:10:60', '8:10:0'));

    let acquired = false;
    const pending = governor.acquire('search', 0).then(() => {
      acquired = true;
    });
    await vi.advanceTimersByTimeAsync(9_000);
    expect(acquired).toBe(false);
    await vi.advanceTimersByTimeAsync(1_100);
    await pending;
    expect(acquired).toBe(true);
  });

  it('minHeadroom is 1 with no observed policies (and for an empty key list)', () => {
    const governor = new RateLimitGovernor(stubSettings().service);
    // Nothing spent yet — a budget-gated feature must not be blocked on startup.
    expect(governor.minHeadroom(['search', 'fetch'])).toBe(1);
    expect(governor.minHeadroom([])).toBe(1);
  });

  it('minHeadroom is 0 for any policy set while globally paused', () => {
    const governor = new RateLimitGovernor(stubSettings().service);
    governor.noteResponse('search', 429, new Headers({ 'Retry-After': '30' }));
    // The pause is global — even a never-observed policy has zero headroom.
    expect(governor.minHeadroom(['fetch'])).toBe(0);
    expect(governor.minHeadroom(['search', 'fetch'])).toBe(0);
  });

  it('minHeadroom reports the TIGHTEST policy of the set (D-pc-2 budget gate)', () => {
    const governor = new RateLimitGovernor(stubSettings().service);
    governor.noteResponse(
      'search',
      200,
      new Headers({
        'X-Rate-Limit-Rules': 'Ip',
        'X-Rate-Limit-Ip': '10:10:60',
        'X-Rate-Limit-Ip-State': '5:10:0',
      }),
    );
    // search has 5/10 free (0.5); fetch is unobserved (1) — the gate must
    // reserve against the tighter budget, not the average.
    expect(governor.minHeadroom(['search', 'fetch'])).toBe(0.5);
    expect(governor.minHeadroom(['fetch'])).toBe(1);
  });

  it('exposes the latest snapshots in status', () => {
    const governor = new RateLimitGovernor(stubSettings().service);
    governor.noteResponse(
      'search',
      200,
      new Headers({
        'X-Rate-Limit-Policy': 'trade-search-request-limit',
        'X-Rate-Limit-Rules': 'Ip',
        'X-Rate-Limit-Ip': '8:10:60',
        'X-Rate-Limit-Ip-State': '1:10:0',
      }),
    );
    expect(governor.status.policies['search']?.policyName).toBe('trade-search-request-limit');
    expect(governor.status.pausedUntil).toBeNull();
  });

  // --- D-dw-19: aggressiveness scales the effective ceiling ---

  it('at A=85 the near-limit hold fires EARLIER than the raw cap', async () => {
    const governor = new RateLimitGovernor(stubSettings(85).service);
    // cap 20, effectiveCap(20,85)=round(17)=17; a bucket at 17/20 must hold even
    // though GGG would still allow 3 more — we deliberately leave margin.
    governor.noteResponse('search', 200, searchHeaders('20:60:120', '17:60:0'));

    let acquired = false;
    const pending = governor.acquire('search', 0).then(() => {
      acquired = true;
    });
    await vi.advanceTimersByTimeAsync(59_000);
    expect(acquired).toBe(false);
    await vi.advanceTimersByTimeAsync(1_100);
    await pending;
    expect(acquired).toBe(true);
  });

  it('at A=120 (risk zone) the hold does NOT fire even at GGG’s cap (429 is the only brake)', async () => {
    const governor = new RateLimitGovernor(stubSettings(120).service);
    // cap 10, effectiveCap(10,120)=12; a bucket at the raw cap 10 is below 12,
    // so we keep firing past GGG's limit — the 429 → pauseAll path is what stops us.
    governor.noteResponse('search', 200, searchHeaders('10:10:60', '10:10:0'));

    let acquired = false;
    const pending = governor.acquire('search', 0).then(() => {
      acquired = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    await pending;
    expect(acquired).toBe(true); // no hold engaged
  });

  it('headroom is computed against the effective ceiling, not GGG’s raw cap', () => {
    // Same bucket (cap 10, used 6 = 60%) read at two aggressiveness levels.
    const raw = stubSettings(100);
    const governorRaw = new RateLimitGovernor(raw.service);
    governorRaw.noteResponse('search', 200, searchHeaders('10:60:120', '6:60:0'));
    expect(governorRaw.headroom('search')).toBeCloseTo(0.4, 5); // (10-6)/10

    const scaled = stubSettings(85);
    const governorScaled = new RateLimitGovernor(scaled.service);
    governorScaled.noteResponse('search', 200, searchHeaders('10:60:120', '6:60:0'));
    // effective ceiling 8.5; (8.5-6)/8.5 ≈ 0.294 — tighter than the raw 0.4.
    expect(governorScaled.headroom('search')).toBeCloseTo(0.294, 3);
  });

  it('reads the aggressiveness LIVE — a settings change applies with no restart', () => {
    const { service, settings } = stubSettings(100);
    const governor = new RateLimitGovernor(service);
    governor.noteResponse('search', 200, searchHeaders('10:60:120', '6:60:0'));
    expect(governor.headroom('search')).toBeCloseTo(0.4, 5);
    // Operator drags the slider down — the very next evaluation reflects it.
    settings.rateLimitAggressiveness = 85;
    expect(governor.headroom('search')).toBeCloseTo(0.294, 3);
  });

  it('fail-closes a corrupt persisted aggressiveness to the safe default (review S2)', () => {
    const { service, settings } = stubSettings(100);
    const governor = new RateLimitGovernor(service);
    // A hand-edited / legacy app_state row could hold a non-number. It must NOT
    // NaN out the governor (NaN comparisons make every near-limit hold false).
    (settings as { rateLimitAggressiveness: unknown }).rateLimitAggressiveness = 'oops';
    governor.noteResponse('search', 200, searchHeaders('10:60:120', '6:60:0'));
    // Clamped to the default 85 → effective ceiling 8.5, headroom ≈ 0.294 (NOT NaN).
    expect(governor.headroom('search')).toBeCloseTo(0.294, 3);
    // Out-of-range clamps into the band, never disarms.
    settings.rateLimitAggressiveness = 9999;
    expect(governor.headroom('search')).toBeCloseTo((12 - 6) / 12, 3); // clamped to 120
  });
});
