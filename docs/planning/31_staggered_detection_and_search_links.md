# 31 — Staggered detection-enable + searches UI polish + trade-site links

**Status: IMPLEMENTED** (2026-07-01).

Four asks in one pass.

## 1. Staggered detection-enable (the main one)

**Problem.** Toggling detection off→on with ~10 searches fired ~10 ws-connects in a tight
synchronous loop (`setDetectionPaused(false)` → `startWatcher` per search). Each
`startWatcher` opens a WebSocket immediately, so the burst tripped the per-minute
ws-connect latch (`GUARD_MAX_WS_CONNECTS_PER_MINUTE`, default 12). Poll ticks were already
serialized by the single round-robin scheduler, so the burst was ws-connects specifically.

**Fix.** Start pending watchers ONE AT A TIME with a `DETECTION_STAGGER_MS` (default 500 ms)
gap. `startPendingWatchers()` — the single choke point used by bootstrap, every scheduler
tick, AND the resume branch of `setDetectionPaused()` — now snapshots the pending set and
fires a fire-and-forget async drip (`startWatchersStaggered`) that `await sleep(gap)` between
each start. Re-entrancy guard (`startingWatchers`) keeps an overlapping tick/resume from
double-starting; each iteration re-checks current state (paused / removed / already-started /
stopped) because a gap is real elapsed time. 0 ms disables the gap.

Config: `DETECTION_STAGGER_MS` in `env.ts` (detection tunables). Bonus: post-guard restarts
(`windDownForGuard` → ticks) now also drip, so recovery after a lockout doesn't re-burst.

## 2. Removed the redundant "live websocket connected" line

That text was the server WS engine's `statusDetail` (`ws-engine.ts`) rendered raw on the row.
With the WS badge (+ its new hover popover) it was noise. The row now suppresses `statusDetail`
whenever `status === 'active'` — keeps it for degraded / no-session / paused (the useful cases),
drops it on the happy path. (Server string left as-is; it's still informative in logs.)

## 3. Hover popovers on the POLL / WS / ACTIVE badges

New atomic `Tooltip` (pure-Tailwind, hover + keyboard focus, `role="tooltip"`, named group so
it can't clash with a row `group`) wraps each badge. Status badges get new `engineStatusDesc.*`
descriptions (EN+PL, all six statuses); the engine badge reuses the existing
`detection.wsTitle` / `detection.pollTitle` strings.

## 4. Trade-site links

- **Search row →** an `ExternalLink` anchor opens the search's trade page. URL built from
  `realm/league/id` already on `SearchRuntimeInfo`, via a new shared single-source
  `tradeSearchPageUrl` (`packages/shared/src/trade-url.ts`) that the server's whisper
  `searchPageUrl()` now delegates to.
- **Live hit → the exact item: NOT possible.** Research (evidence in `api-notes.md`) found no
  trade-site URL that deep-links a single listing, and `listingId` is ephemeral/re-served, so
  even if one existed the id wouldn't be a durable handle (hard rule #2 — don't invent one).
  **Open decision for Bartosz:** add a search-page link on each live hit too (opens the hit's
  search, not the exact item) — yes/no.

## Tests

`search-manager.test.ts`: enabling detection drips 3 searches out with the 500 ms gap
(fake timers assert ws engines appear 1 → 2 → 3 across the gaps). Existing
`searchPageUrl` test still green (delegation preserves the exact output).
