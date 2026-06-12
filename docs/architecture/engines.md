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

## One ws connection per search, one shared availability probe

GGG's live endpoint is keyed by search id in the URL
(`/api/trade2/live/<realm>/<league>/<id>`) — there is no multiplexing
protocol, so **each search has its own ws connection** when push is up. This
matches the real trade site (one socket per open live search). N searches = N
sockets, exactly like the site; our guard ceilings cap reconnect storms, not
steady state.

But the live backend is up or down **globally**, so checking whether it
recovered is a single shared concern, not per-search:

- A **single background probe** (`WS_UPGRADE_PROBE_INTERVAL_MS`) runs on its
  **own timer, off the poll tick** — a slow handshake never delays detection.
  One probe answers for every poll-mode search.
- On success it flips a flag; the next poll tick promotes poll searches to ws
  **synchronously** (so it never races the poll loop), throttled by the guard's
  ws-connect ceiling (the rest defer to the next window).
- **No dark reconnect ladder.** When a ws connection drops: a drop after a
  stable run is a routine GGG drop → one quick reconnect (like the real
  client); a drop before stable, or close code **1013** ("Try Again Later"), →
  the search demotes **straight to poll** so detection keeps running at a safe
  cadence. The shared probe re-promotes it once the backend is confirmed up.
  The old per-search upgrade probe and the long reconnect-ladder dark wait are
  gone.

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
