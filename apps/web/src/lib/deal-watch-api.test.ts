import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchDealHistory, requestDealRefresh } from './deal-watch-api';

function stubFetch(response: {
  ok: boolean;
  status: number;
  body?: unknown;
  brokenBody?: boolean;
}): void {
  const jsonImplementation = response.brokenBody
    ? () => Promise.reject(new Error('no body'))
    : () => Promise.resolve(response.body);
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: response.ok,
        status: response.status,
        json: jsonImplementation,
      } as Response),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestDealRefresh', () => {
  it('returns ok on a 2xx response', async () => {
    stubFetch({ ok: true, status: 200 });
    expect(await requestDealRefresh('abc')).toEqual({ kind: 'ok' });
  });

  it('parses the 429 cooldown body into retryInMs', async () => {
    stubFetch({
      ok: false,
      status: 429,
      body: { code: 'deal-refresh-cooldown', retryInMs: 42_000 },
    });
    expect(await requestDealRefresh('abc')).toEqual({ kind: 'cooldown', retryInMs: 42_000 });
  });

  it('rejects a cooldown body with a broken retryInMs as failed', async () => {
    stubFetch({
      ok: false,
      status: 429,
      body: { code: 'deal-refresh-cooldown', retryInMs: 'soon' },
    });
    expect(await requestDealRefresh('abc')).toEqual({ kind: 'failed' });
  });

  it('parses each 409 declined code', async () => {
    for (const code of ['archived', 'disabled', 'paused', 'guard-tripped'] as const) {
      stubFetch({ ok: false, status: 409, body: { code: `deal-refresh-${code}` } });
      expect(await requestDealRefresh('abc')).toEqual({ kind: 'declined', code });
    }
  });

  it('treats an unknown 409 code as failed, never invents a message', async () => {
    stubFetch({ ok: false, status: 409, body: { code: 'deal-refresh-mystery' } });
    expect(await requestDealRefresh('abc')).toEqual({ kind: 'failed' });
  });

  it('degrades an unparseable body and a network error to failed', async () => {
    stubFetch({ ok: false, status: 500, brokenBody: true });
    expect(await requestDealRefresh('abc')).toEqual({ kind: 'failed' });

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('network down'))),
    );
    expect(await requestDealRefresh('abc')).toEqual({ kind: 'failed' });
  });
});

describe('fetchDealHistory', () => {
  it('requests the history endpoint with the limit and returns the entries', async () => {
    const entries = [
      {
        amountExalted: 500,
        rawLowestExalted: 450,
        sampleSize: 7,
        rederived: true,
        computedAt: '2026-07-05T10:00:00.000Z',
      },
    ];
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(entries) } as Response),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchDealHistory('abc', 200)).resolves.toEqual(entries);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/searches/abc/deal-history?limit=200',
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    );
  });
});
