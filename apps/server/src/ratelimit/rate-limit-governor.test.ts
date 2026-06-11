import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimitGovernor } from './rate-limit-governor.js';

describe('RateLimitGovernor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('spaces consecutive acquisitions of the same policy', async () => {
    const governor = new RateLimitGovernor();
    const order: number[] = [];

    const first = governor.acquire('fetch', 600).then(() => order.push(Date.now()));
    const second = governor.acquire('fetch', 600).then(() => order.push(Date.now()));

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(600);
    await Promise.all([first, second]);

    expect(order[1]! - order[0]!).toBeGreaterThanOrEqual(600);
  });

  it('does not couple unrelated policies', async () => {
    const governor = new RateLimitGovernor();
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
    const governor = new RateLimitGovernor();
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

  it('holds a policy whose bucket reports near-cap usage', async () => {
    const governor = new RateLimitGovernor();
    governor.noteResponse(
      'search',
      200,
      new Headers({
        'X-Rate-Limit-Rules': 'Ip',
        'X-Rate-Limit-Ip': '8:10:60',
        'X-Rate-Limit-Ip-State': '7:10:0',
      }),
    );

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

  it('exposes the latest snapshots in status', () => {
    const governor = new RateLimitGovernor();
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
});
