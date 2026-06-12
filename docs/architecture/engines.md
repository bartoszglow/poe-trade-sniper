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
a session import) and re-probes ws for one poll watcher per
`WS_RECONNECT_MAX_MS` window — when GGG live returns, searches upgrade to push
automatically.

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
