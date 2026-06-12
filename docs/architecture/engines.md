# Detection engines

## The registry contract (open/closed core)

`apps/server/src/search/engine-registry.ts` builds the ordered factory list:

```
[ ws, poll ]
```

The SearchManager walks the registry and picks the **first factory whose
`probe()` passes**. Adding a detection strategy = appending a factory; the
manager, scheduler and API never change. Poll sits last as the
always-available fallback (its probe is constant-true).

## WsEngine (push, near-zero latency)

- `wss://…/api/trade2/live/<realm>/<league>/<id>` with session cookies + UA.
- **Tarpit guard:** the handshake always carries cookies and a timeout —
  unauthenticated handshakes hang forever (api-notes).
- Frames: `{"new": [listingId, …]}` → fetch via trade-api → emit listings.
- Reconnect: exponential backoff `WS_RECONNECT_BASE_MS → WS_RECONNECT_MAX_MS`
  (aggressive reconnects burn the per-IP budget); keepalive ping.
- Reality check: GGG's live backend has been 504-down since ~patch 0.5.0, so
  the probe usually fails and searches run on poll.

## PollEngine (fallback)

- Re-runs the search newest-first and diffs ids against a bounded seen-set
  (`SEEN_IDS_CAP`, insertion-order eviction).
- First round is a **baseline**: current listings are marked seen, never
  alerted (they pre-date the watch).
- Fresh ids per round are capped (`MAX_FRESH_IDS_PER_TICK`) — a broad search
  at peak turns over 100+ ids per poll and would burn the fetch budget.
- A 429 reports `degraded` and skips the round; the governor has already
  paused all outbound traffic.

## The shared scheduler

One `setInterval(POLL_INTERVAL_MS)` in the SearchManager — **one search POST
per tick, round-robin across all polled searches**, because the search budget
is per-IP, not per-search. The tick also retries pending watchers (e.g. after
a session import).

## Persistent ws per search + poll gap coverage

GGG's live endpoint is keyed by search id in the URL
(`/api/trade2/live/<realm>/<league>/<id>`) — there is no multiplexing protocol,
so **each search owns one persistent ws connection**, exactly like a single
browser trade tab. N searches = N sockets, just like opening N tabs.

Each enabled search runs **both** engines, composed by the SearchManager:

- **`WsEngine` (primary, persistent).** One socket, kept alive, that **never
  gives up**: every close — including close code **1013 "Try Again Later"** —
  just schedules a reconnect on the backoff ladder (`WS_RECONNECT_LADDER_MS`,
  1013 jumps to the top rung), resetting only after a connection stays up
  `WS_STABLE_CONNECTION_MS`. It does not churn (no throwaway probe, no
  open/close cycling), which is what kept triggering GGG's 1013 backoff before.
- **`PollEngine` (gap coverage).** Runs **only while the ws socket is not
  connected**. The round-robin scheduler ticks the poll engines of watchers
  whose `wsConnected === false`; the moment ws reports `active`, that watcher's
  poll engine is torn down. A fresh poll engine is created per gap, so it
  re-baselines and never re-reports listings ws already pushed.

Result: no detection hole (poll covers reconnects), no double traffic when ws
is up (poll is off then), and no connection churn — the behaviour a browser
tab has. The displayed engine (`GET /api/searches`, the app-bar pills) is `ws`
while connected and `poll` while it covers a gap.

## Status model

`pending → connecting → active ⇄ degraded → stopped`, surfaced per search via
`GET /api/searches` and the `engine-status` SSE event.

## Pause (enabled flag)

Every search carries a persisted `enabled` flag (`PATCH /api/searches/:id
{enabled}`; the ACTIVE toggle in the UI). Disabling stops the engine and parks
the watcher at `stopped`/`paused` — zero outbound traffic, config and hit
history kept; re-enabling restarts detection through the normal registry
probe. The flag survives restarts: a paused search boots straight to
`stopped`.
