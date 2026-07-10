# 43 — Sticky degraded + timed recovery + room-level health surfacing

**Status:** P1 + P2 IMPLEMENTED 2026-07-10 (P3 parked). Q1 answered: defaults
accepted (5/10/30 min ladder, 5-min stable window). Q2 answered: pattern-only
(3 drops / 10 min); single drops stay masked. D-deg-1..5 CONFIRMED.
**Origin:** operator request 2026-07-10: a degraded search must not flip back to
`active` on its own — it stays flagged degraded and gets re-launched after a
while; a collapsed room must surface that a member is degraded; plus any other
degraded gaps worth fixing.

## Current behaviour (evidence audit, 2026-07-10)

Six degrade sites, two recovery quirks, zero restart capability:

| #   | Trigger                           | detail code              | Detection while degraded                               | Today's visibility                                                                            |
| --- | --------------------------------- | ------------------------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| A   | ws: no session                    | `no-session`             | effectively **blind** (poll throws NoSessionError too) | usually masked to `active` by poll's own status                                               |
| B   | ws: guard gate at connect         | `guard-halted`           | **blind**                                              | visible, engines dead-end (no retry timer)                                                    |
| C   | ws close 1013                     | `ws-rate-limited`        | poll covers — detecting                                | **visible + FLAPS** active↔degraded every ~5 min (`WS_RATE_LIMIT_BACKOFF_MS`), zero damping   |
| D   | any other ws close                | `ws-reconnecting`        | poll covers — detecting                                | **masked**: poll start publishes `active` synchronously; only the ws→poll engine chip changes |
| E   | poll: governor paused             | `rate-limited`           | delayed, retried next rotation                         | visible, but **lingers after recovery** (successful ticks are status-silent)                  |
| F   | poll tick threw / guard wind-down | `error` / `guard-halted` | retried next rotation / blind                          | `error` lingers like E; guard wind-down stops engines                                         |

- Recovery to `active` is **instant** on ws reopen (`onWsStatus`, search-manager
  ~1343) — no hysteresis anywhere; the only stability notion is the ws backoff
  ladder reset (`WS_STABLE_CONNECTION_MS` 60 s), which does not gate the status.
- `startPendingWatchers` only picks up engine-null watchers → **a degraded
  watcher with live engines is never restarted by anything.**
- Room header (RoomSection) shows member count + master switch only — a
  collapsed room fully hides a degraded member. AppBar pills are engine-kind
  (WS/POLL) only. No sound/notification/activity entry on a degrade. Status is
  runtime-only (restart wipes it) and hitCount keeps counting while degraded.

## Design

### 1. Health model (server, runtime-only)

Watcher gains a health record (no DB change; status stays runtime-only —
**D-deg-5**):

```
health: {
  stickyDegraded: boolean;      // the operator-visible flag — cleared only by rules below
  degradedSince: string | null; // ISO — drives "degraded for 23m" display
  lastDetail: EngineStatusDetailCode | null;
  recoveryAttempts: number;     // drives the restart backoff ladder
  lastRecoveryAt: number | null;
  wsDropsWindow: number[];      // recent ws-close timestamps (flap detector)
}
```

Published status = `stickyDegraded ? 'degraded' : <current signal>` — the
toggle/status single-source rule from the room refactor extends to health: one
derivation point (`publishEngineStatus` wrapper), no scattered writes.

### 2. Degrade families → sticky rules (D-deg-1)

Not every degrade deserves stickiness — three families:

- **Connection-health (sticky):** `ws-rate-limited` (C) enters sticky
  immediately; ordinary drops (D) stay masked BUT a flap detector escalates:
  ≥ `DEGRADED_FLAP_DROPS` (default 3) ws closes within
  `DEGRADED_FLAP_WINDOW_MS` (default 10 min) → sticky with new detail code
  `ws-unstable`. Rationale: single drops are routine and poll covers; a pattern
  is a real problem the operator must see.
- **Throughput (self-healing, NOT sticky):** `rate-limited`, transient `error`.
  Fix the lingering instead: the poll engine emits `onStatus('active', …)` on
  the first successful tick after a failed one → row recovers honestly.
- **Blind (sticky until the gate lifts):** `guard-halted`, `no-session`. No
  auto-restart while the gate is down (pointless spend); when the gate lifts
  (guard reset / session loaded), a recovery restart runs and the stability
  window applies before clearing.

### 3. Timed recovery restart (D-deg-2)

New scheduler sweep (piggybacks the existing 12 s tick): for every
sticky-degraded, enabled, non-archived, room-enabled watcher whose
`now - lastRecoveryAt > backoff(recoveryAttempts)` → full engine recycle via
the existing guard-safe `restartViaDrip` (never a burst; drip + governor own
pacing). Backoff ladder `DEGRADED_RESTART_BACKOFF_MS` default
`300000,600000,1800000` (5 m → 10 m → 30 m, capped at the last rung).
Blind-family watchers are skipped while their gate is down.

### 4. Clearing sticky — stability window (D-deg-3)

Sticky clears ONLY after the connection stays healthy (ws connected, no close,
no 1013) for `DEGRADED_CLEAR_STABLE_MS` (default 300 000 = 5 min) following a
recovery restart or spontaneous reconnect. Until then the row shows
`degraded` with the real detail — no more active↔degraded flap: transitions
become degraded → (stable 5 min) → active, or degraded → degraded (attempt++).
Timer lives in the SearchManager (engines stay history-less).

### 5. UI surfacing (operator view — no mockup needed, small chips)

- **Row:** degraded badge gains "for 23m" (from `degradedSince`) in the hover
  desc; detail panel's Automation/status card gets a **Restart now** button →
  new `POST /api/searches/:id/restart` → `restartViaDrip` + resets the backoff
  counter (also useful outside degraded — D-deg-4).
- **Collapsed room header (the ask):** client-derived from members (no server
  change): any member degraded → a danger chip `⚠ N degraded` next to the
  member-count badge; click expands the room and spotlights the first degraded
  member (reuses the #34 spotlight). Worst-of aggregation, `degraded` only
  (paused/stopped members don't warn).
- **Nav-level:** the AppShell already derives ws/poll counts — add a degraded
  count; AppBar shows a danger dot+count pill when > 0 (rooms can be collapsed
  AND scrolled away; this is the "something is wrong somewhere" beacon).

### 6. Parked (phase 3 — separate opt-in)

- System notification on ENTRY into sticky degraded (gated by the existing
  notifications toggle) — silent degrade overnight is currently invisible.
- Activity-feed entries for degrade/recover transitions (history: "degraded 3×
  last night, recovered each time").
- Settings-view knobs for the ladders (env-only until proven needed).

## Config (env, centralized — no magic numbers)

| Var                           | Default                 | Meaning                                                           |
| ----------------------------- | ----------------------- | ----------------------------------------------------------------- |
| `DEGRADED_FLAP_DROPS`         | 3                       | ws closes within the window that escalate to sticky `ws-unstable` |
| `DEGRADED_FLAP_WINDOW_MS`     | 600 000                 | the flap-detection window                                         |
| `DEGRADED_RESTART_BACKOFF_MS` | `300000,600000,1800000` | recovery-restart ladder (capped at last rung)                     |
| `DEGRADED_CLEAR_STABLE_MS`    | 300 000                 | healthy time required to clear sticky                             |

## Phases

1. **P1 server core:** health record + family rules + flap detector + recovery
   sweep + stability clearing + poll-recovery emit (E/F lingering fix) + unit
   tests (flap → sticky; sticky survives a brief reconnect; clears after stable
   window; backoff ladder; blind-family skip; restart endpoint).
2. **P2 visibility:** room header chip + spotlight hookup, AppBar degraded
   pill, row "for Xm" + Restart-now button, i18n EN+PL.
3. **P3 (parked):** notifications, activity entries, Settings knobs.

## Decisions

- **D-deg-1** — three degrade families with different stickiness (connection =
  sticky w/ flap detector; throughput = self-healing + lingering fix; blind =
  sticky until gate lifts). PENDING operator confirmation (Q2).
- **D-deg-2** — timed recovery restarts via the scheduler sweep +
  `restartViaDrip`, exponential ladder 5/10/30 min. PENDING (Q1).
- **D-deg-3** — sticky clears only after a 5-min stable window; no instant
  active on reconnect. PENDING (Q1).
- **D-deg-4** — manual `Restart now` row action (works for any status).
- **D-deg-5** — health stays runtime-only (a process restart is itself a
  recovery); no schema change.

## Open questions (operator)

- **Q1 — cadences:** restart ladder 5 → 10 → 30 min and a 5-min stable window
  to clear — good defaults?
- **Q2 — ordinary ws drops:** keep single drops masked (poll covers; only the
  ws→poll chip changes) and go sticky only on a PATTERN (3 drops / 10 min), or
  make every ws drop visibly degraded (much noisier rows)? Recommendation:
  pattern-only.
