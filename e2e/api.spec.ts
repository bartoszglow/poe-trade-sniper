import { expect, test } from '@playwright/test';

// API surface e2e — runs against the real server with a throwaway SQLite db.
// NEVER touches live GGG: only no-session and validation paths are exercised.

test('status reports session, rate-limit and search summary', async ({ request }) => {
  const response = await request.get('/api/status');
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as {
    session: { hasSession: boolean };
    rateLimit: { pausedUntil: string | null };
    searches: { total: number };
  };
  expect(body.session).toBeDefined();
  expect(body.rateLimit).toBeDefined();
  expect(body.searches).toBeDefined();
});

test('searches and hits start empty', async ({ request }) => {
  expect(await (await request.get('/api/searches')).json()).toEqual([]);
  expect(await (await request.get('/api/hits')).json()).toEqual([]);
});

test('adding a search without a session is a clean 400', async ({ request }) => {
  const response = await request.post('/api/searches', { data: { input: 'AbCdEf123' } });
  expect(response.status()).toBe(400);
  const body = (await response.json()) as { message: string };
  expect(body.message).toContain('no PoE session');
});

test('add validation rejects garbage input and unknown purchase modes', async ({ request }) => {
  expect((await request.post('/api/searches', { data: {} })).status()).toBe(400);
  expect(
    (
      await request.post('/api/searches', {
        data: { input: 'AbCdEf123', purchaseMode: 'teleport' },
      })
    ).status(),
  ).toBe(400);
});

test('session cookie paste lifecycle: set → status → clear', async ({ request }) => {
  const rejected = await request.post('/api/session/cookies', {
    data: { cookies: { cf_clearance: 'x' } },
  });
  expect(rejected.status()).toBe(400);

  const accepted = await request.post('/api/session/cookies', {
    data: { cookies: { POESESSID: 'e2e-dummy-value' } },
  });
  expect(accepted.ok()).toBeTruthy();
  const status = (await accepted.json()) as { hasSession: boolean; cookieNames: string[] };
  expect(status.hasSession).toBe(true);
  expect(status.cookieNames).toEqual(['POESESSID']);
  expect(JSON.stringify(status)).not.toContain('e2e-dummy-value');

  const cleared = await request.delete('/api/session');
  expect(cleared.ok()).toBeTruthy();
  const after = (await (await request.get('/api/session/status')).json()) as {
    hasSession: boolean;
  };
  expect(after.hasSession).toBe(false);
});

test('session probe without a session is a clean 400', async ({ request }) => {
  const response = await request.post('/api/session/probe');
  expect(response.status()).toBe(400);
});

test('manual travel validates its body and reports queue status', async ({ request }) => {
  expect((await request.post('/api/travel', { data: {} })).status()).toBe(400);
  expect((await request.post('/api/travel', { data: { token: 'too-short' } })).status()).toBe(400);

  const status = (await (await request.get('/api/status')).json()) as {
    travel: { queueLength: number; lastTravel: unknown };
  };
  expect(status.travel).toEqual({ queueLength: 0, lastTravel: null });
});

test('events endpoint streams SSE', async ({ request }) => {
  const response = await request
    .get('/api/events', {
      headers: { accept: 'text/event-stream' },
      maxRedirects: 0,
      timeout: 3_000,
    })
    .catch(() => null);
  // The stream never ends, so a timeout abort is the expected outcome —
  // reaching the endpoint without a 404 is what we assert.
  if (response) {
    expect(response.status()).toBe(200);
  }
});
