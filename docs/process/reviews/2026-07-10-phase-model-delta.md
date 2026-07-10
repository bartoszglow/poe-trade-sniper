# Code review — search phase model delta (plans 43 + 44)

**Date:** 2026-07-10
**Scope:** `git diff aca1883..HEAD` (HEAD = `54f2797`) — focused delta review.
**Commits reviewed:**

- `54f2797` feat(search): phase state machine — sticky degraded, halted, honest toggles (plans 43+44)
- `05a7d09` fix(server): reject cross-site Origin on the loopback API (SEC-1)
- (`8a8820a` — the prior review record doc — deliberately skipped.)

**Not re-litigated:** the 2026-07-10 full-codebase review
(`docs/process/reviews/2026-07-10-full-codebase.md`) already covered the rest of
the tree and the earlier plan-43 snapshot; this record covers only what this
delta introduced or changed.

**Standards injected (authoritative):** CLAUDE.md 8 hard rules,
`docs/process/conventions.md`, `docs/planning/43_degraded_handling.md`
(D-deg-1..5), `docs/planning/44_search_phase_model.md` (D-ph-1..3),
`docs/planning/41` (D-dw-20).

**Reviewers fanned out (parallel):** correctness, architecture, reliability,
testing, consistency, frontend, security (SEC-1 focus), performance (sweep
focus). Every finding routed through `review-verifier` (adversarial) before
gating. `review-browser` not used (static review only, per request).

---

## Verdict: **BLOCKED**

One confirmed **S2** remains un-deferred (**F1** — bulk gate reopen silently
revives a `halted` search). S1 count is 0. Recommendation: fix F1 before merge;
the rest are fix-in-PR-or-track (S3) and batch (S4).

| Severity | Count | Gate                          |
| -------- | ----- | ----------------------------- |
| S1       | 0     | —                             |
| S2       | 1     | **blocks** (F1, not deferred) |
| S3       | 11    | fix in PR or track            |
| S4       | 7     | batch, non-blocking           |

(20 findings verified; F2 adjusted S2→S3 by the verifier. All 20 CONFIRMED, none refuted.)

---

## S2 — blocking

### F1 · S2 · `apps/server/src/search/search-manager.ts` (`setRoomEnabled` ~816-828, `setDetectionPaused` ~1219-1223, `publishEngineStatus` ~1717-1723)

**What:** A bulk gate round-trip (global pause→resume, or room disable→enable)
silently revives a `halted` search. **Why:** "halted-ness" lives _only_ in
`watcher.status === 'halted'`; a halted watcher still has `row.enabled === true`.
The gate-close loops skip only `!row.enabled`, so they clobber
`status: halted → 'paused'`, erasing the marker. On reopen the loop publishes
`'pending'`, which `publishEngineStatus` rewrites to `'degraded'` (sticky still
armed) — so `startPendingWatchers`' `status !== 'halted'` filter sees
`'degraded'`, includes it, and fires a fresh ws connect. Confirmed independently
by correctness, reliability, and consistency, and by the verifier end-to-end for
**both** room and global gates.

**Contract broken:** plan-44 explicit invariant — _"Bulk gate reopenings
(room/global) do NOT [revive halted] — the drip excludes halted exactly like
stopped"_ — and CLAUDE.md hard-rule 4 (a revived halted search re-burns
ws-connect budget the governor is meant to protect; lockouts stack). After
revival the sweep re-halts a rung later, producing a paused→degraded→halted flap
on every operator room/global toggle, and can even clear to `active` if the
socket holds for the 5-min window — exactly the budget-burn `halted` exists to
stop.

**Fix (verifier's load-bearing caveat):** the naive "skip halted in the
close-loop" is **insufficient** — held-outranks (D-ph-2) still wants the display
to read `paused` while the gate is closed, and the reopen re-derives via sticky.
The real fix is a **durable marker** (e.g. `health.halted: boolean`, cleared by
`freshHealth()` so Restart / own-toggle still revive cleanly): set it where
`'halted'` is published; have `publishEngineStatus` re-derive running-ish
statuses to `'halted'` (not `'degraded'`) while `health.halted`; held statuses
(`paused`/`stopped`) still pass on close, and on reopen the `'pending'` resolves
back to `'halted'`, which the drip/`startPendingWatchers` already exclude. This
closes global, room, bootstrap, and import reopen paths in one spot. **Ship F1 +
F6 (extract `isEligibleToRun`) + F11 (the missing bulk-reopen test) together —
they are one defect class.**

---

## S3 — fix in PR or track

- **F2 · `search-manager.ts` `sweepStickyDegraded` ~1296-1342 / `runSchedulerTick` ~1238-1284** — No error boundary: the per-watcher sweep body is unguarded and `runSchedulerTick` has `try/finally` with **no `catch`**; production call is `void this.runSchedulerTick()` and there is **no** `process.on('unhandledRejection')` anywhere in `apps/`/`packages/`. A sync throw in the sweep → unhandled rejection → process crash (Node default policy), silently killing all detection. _Adjusted S2→S3:_ catastrophic-but-improbable (sweep only calls `stopEngines`/`publishEngineStatus`/sync `startPendingWatchers`). **Fix:** wrap the sweep body per-watcher in try/catch (`continue` on throw) + add a `.catch` to the tick. Consider keeping at S2 if the team treats the sole detection loop as crash-critical.
- **F3 · `search-manager.ts` sweep ~1321-1340** — Stale recovery clock on gate reopen: `health.lastRecoveryAt` is frozen while held (sweep skips `!roomEnabled`); nothing re-seeds it on reopen, so the first post-reopen sweep sees a stale `now - lastRecoveryAt >= waitMs` and immediately fires an extra `restartViaDrip`, interrupting the fresh connect and advancing `recoveryAttempts` toward `halted` for time the search was _held_, not failing. **Fix:** re-seed `lastRecoveryAt` (and leave `stableSince` null) on gate reopen.
- **F4 · `search-manager.ts` sweep ~1340 + `restartViaDrip` ~707-730** — Sweep can open a detection gap: `restartViaDrip` nulls both engines then calls `startPendingWatchers`, which early-returns when `startingWatchers` is already true (a startup/mass drip in flight). The swept watcher is left engine-null (also excluded from poll coverage) until a later tick re-drips. Bounded/self-healing (~one tick), but a trade sniper's gap = missed hits. **Fix:** `if (this.startingWatchers) continue;` before the recovery restart, or recycle only the ws engine and keep poll coverage up.
- **F5 · `apps/web/src/shell/AppShell.tsx` ~94** — AppBar beacon over-counts intentionally gate-held searches: it keys off `degradedSince !== null`, which correctly lingers across a hold (D-ph-2 keeps history), so a now-`paused` sticky search still lights the red "something is wrong" beacon during a deliberate pause — while `room-state-breakdown` (keys off `status`) buckets it as held. The two surfaces disagree. **Fix:** require an attention-needing phase too, e.g. `(status === 'degraded' && degradedSince !== null) || status === 'halted'`.
- **F6 · `search-manager.ts` (radar, NOW)** — The eligibility core `row.enabled && archivedAt === null && roomEnabled(watcher)` is open-coded at **4+** sites (sweep ~1302, `setDetectionPaused` ~1219, `windDownForGuard` ~1367 `intendedRunning`, `startPendingWatchers` ~1391). Meets the 3+ radar threshold; this is exactly the forgotten-gate class the delta was patching. **Refactor:** extract `private isEligibleToRun(watcher)`; the start/stop/sweep sites compose their extra clauses on top. Take **now** (ships with F1).
- **F7 · `search-manager.ts` (radar, PARK)** — God-file at **2020 lines** (5× the ~400 threshold). The plan-43 health FSM (`WatcherHealth`, `freshHealth`, `enterStickyDegraded`/`clearStickyDegraded`/`sweepStickyDegraded`) is a cohesive, separable seam (mutates `watcher.health`, calls back into `publishEngineStatus`/`restartViaDrip`/`stopEngines`). **Park with a tracked ticket** — don't extract inside this already-large commit's blast radius, but flag before it calcifies past 2k.
- **F8 · `apps/web/src/shell/AppBar.tsx` ~67-75** — Beacon a11y: bare `<span>` with `title` only, color-only red dot, number-only text; SR-inaccessible and count changes unannounced. **Fix:** `role="status"` + `aria-label` with the full translated string, mark the dot `aria-hidden`. (Operator-only tool → borderline S4.)
- **F9 · `apps/web/src/components/RoomSection.tsx` ~190-208** — Breakdown cluster is unconditionally a `<button>`; since `button` is in `ROW_EXPAND_EXCLUDED_SELECTOR`, it swallows the header's click-to-expand (dead zone) and is an inert keyboard tab stop when `!hasHealthConcern` (no-op onClick); the `data-no-expand` attr is dead (button already excluded). Collapse still reachable via the CollapseIcon → minor. **Fix:** render a `<div>`/`<span>` unless `hasHealthConcern`; drop `data-no-expand`.
- **F10 · `apps/web/src/pages/SearchesPage.tsx` ~118-124 (consistency)** — Cross-surface tone divergence: `STATUS_TONES.degraded = 'danger'` (row badge, red) vs `'warn'` (amber) on the toggle (~657) and the room breakdown (`room-state-breakdown.ts:39`); and `halted` is **also** `'danger'` on the row, so degraded/halted are the same red there (disambiguated only by label). Plan-44: degraded = amber/warn, halted = the lone loudest danger. This change aligned toggle+room but left the row badge clashing. **Fix:** row `STATUS_TONES.degraded → 'warn'`, keep halted as the sole danger.
- **F11 · `search-manager.test.ts`** — No test that a bulk room/global gate reopen does NOT revive a `halted` watcher (only own-toggle revival at :1329 is tested) — the exact test that would fail on F1. **Add** with F1's fix. (`restartSearch`-from-halted also uncovered; low value since `freshHealth()` makes prior state moot.)
- **F12 · `search-manager.test.ts`** — Held-outranks-degraded round-trip (gate close mid-sticky → paused with history kept → reopen resumes `degraded` with the same `degradedSince`) untested.
- **F13 · `search-manager.test.ts`** — Import-into-a-disabled-room → held-not-started (the `startWatcher`→`startEnabledWatcher` switch) untested.

## S4 — batch, non-blocking

- **F14 · `apps/server/src/api/host-guard.middleware.ts` ~30,35** — Comment claims `URL.hostname` strips IPv6 brackets, but in this Node runtime `new URL('http://[::1]:3500').hostname === '[::1]'` (with brackets), so the `!== '::1'` branch is dead. **No security impact** — `ALLOWED_HOSTNAMES` contains the bracketed `'[::1]'`, so `::1` is allowed via the set regardless. Cosmetic: fix the comment, drop the dead branch.
- **F15 · `search-manager.ts` (PARK)** — Recovery ladder rungs carry no jitter (unlike ws reconnect), so a fleet-wide degrade seeds all `lastRecoveryAt` together; but the `startingWatchers` latch + drip snapshot defuse any burst (first restart seizes the latch, rest trickle across ticks). No connect burst. Park unless resync is seen in the field.
- **F16 · `search-manager.ts` ~1311,1329,1336** — New recovery/halt lifecycle logs carry `row.id` but not `watcher.correlationId` (which the rest of the search's logs thread), hurting correlation of a HALTED with its preceding failure legs. (Credential rule 3 clean — no session/cookie/UA in any new log.)
- **F17 · `apps/web/src/shell/AppBar.tsx` ~70** — Beacon hand-rolls `bg-danger/15 text-danger` instead of building on the `Badge` atom (which the room breakdown reuses correctly). Consider `Badge tone="danger"` with a leading-dot slot, or a small `Beacon` atom.
- **F18 · `apps/web/src/components/search-panel/SettingsCard.tsx` ~130-136** — `actionBusy` disables only Restart; Archive/Delete stay visually enabled but no-op (`if (actionBusy) return`). No real double-action (the `run()` guard + Delete opens a dialog) — purely a missing disabled affordance.
- **F19 · `apps/web/src/i18n/messages.ts` ~1332/1360** — `rooms.degradedCount` plural key (EN+PL) defined but unreferenced (the "N degraded" chip was replaced by the per-state breakdown). Dead key — delete both.
- **F20 · `poll-engine.ts:66` + `search-manager.ts:~1281`** — `'polling (recovered)'` free-form detail literal duplicated; not an `EngineStatusDetailCode`. Acceptable (emitted only on `'active'`, where detail is hidden → logs-only); const-extract if a third site appears.

---

## Verified safe (aggregated CLEAN across the specialists)

**Server / phase machine (correctness, reliability, consistency, architecture):**

- Single phase setter (invariant 5) upheld — the only live-transition `.status =`
  writer is inside `publishEngineStatus`; the two other assignments are
  construction/carry, not bypassed transitions. Sticky suppression + held-priority
  centralized there; the old `wsRateLimited` special-case correctly deleted from
  `onPollStatus`.
- Sticky rewrite touches only `active|connecting|pending`; `stopped`/`paused`
  (held) and `halted` pass through → held outranks health (D-ph-2). Flag clears
  solely via `freshHealth()` (clear/restart/re-enable) — no other reset path.
- Held-outranks for a **degraded** (non-halted) watcher: gate close → `paused`
  with health untouched (history survives); reopen → sticky-rewritten `degraded`,
  engines drip back, stability window re-arms. Correct. (The **halted** sub-case
  is F1.)
- Bootstrap + import reconcile: enabled-but-gated members relabeled `paused`
  before `startPendingWatchers`; import routes through `startEnabledWatcher`
  (gates both global + room). No path to a lying `pending`/`active` under a closed
  gate. (The reported "lying pending after restart" bug is closed.)
- Recovery ladder + flap boundaries: `wsDrops.length >= DEGRADED_FLAP_DROPS`
  fires on the 3rd drop; `ladder[Math.min(recoveryAttempts, len-1)]` index-safe;
  halt boundary yields exactly 6 restarts then `halted` (matches `5+10+30×4`);
  `lastRecoveryAt` seeded at entry so the first restart is a full rung later.
- Transient-error lingering fix: `hadTransientError` guard + the poll-engine
  `lastTickRateLimited` twin are disjoint (`error` vs `rate-limited`) — no
  double-emit, no missed clear; fresh `PollEngine` per restart resets the flag.
- `halted` skip honored by `startPendingWatchers`, the in-flight drip loop, and
  the sweep guard; `restartViaDrip`/`startEnabledWatcher` re-`pending` a halted
  row only after `freshHealth()` on an explicit act.
- No handle/timer leak across the ladder (each `stopEngines` clears socket +
  reconnect timer, fresh engines per rung); `wsDrops` bounded by the flap-window
  filter on every degrade; sweep unreachable while the guard is tripped; sweep +
  top-of-tick `startPendingWatchers` cannot double-start (disjoint null/non-null
  snapshots + single-flight latch).
- Config fully externalized in the Zod env schema (`DEGRADED_FLAP_DROPS=3`,
  `DEGRADED_FLAP_WINDOW_MS=600000`, `DEGRADED_RESTART_BACKOFF_MS=300000,600000,1800000`,
  `DEGRADED_CLEAR_STABLE_MS=300000`, `DEGRADED_MAX_RECOVERY_ATTEMPTS=6`) — no
  magic numbers, defaults match plans 43/44.
- Runtime-only (D-deg-5 / D-ph-4): no migration/drizzle/`.sql`/schema change in
  the delta.

**Performance:** sweep is O(n) per 12s tick (non-sticky = O(1) skip); the feared
per-candidate re-scan is bounded to one real scan/tick by the `startingWatchers`
latch; `restartViaDrip` does no DB/re-derivation work; `SearchRuntimeInfo.degradedSince`
is one nullable ISO string. No hot-path concern.

**Security (SEC-1 host-guard):** cross-site Origin rejected; `null` origin
rejected (`new URL('null')` throws → Forbidden); malformed Origin rejected;
no-Origin allowed (modern browsers attach Origin to all cross-origin
POST/CORS-simple; it's a Forbidden header, unspoofable from page JS); loopback
`localhost`/`127.0.0.1`/`[::1]` allowed; port/scheme ignored (fine for loopback);
global wiring via `forRoutes('*')` covers every route incl. the new
`POST searches/:id/restart`; no mutating GET, no WS gateway bypass. New
server log lines carry no session/cookie/UA (hard-rule 3 upheld).

**Frontend:** Switch tone truth honored — gold only for `active`, blue for
`paused`, amber otherwise, grey when OFF; position bound to intent, never
silently flips. Restart wiring: in-flight double-POST guard present, errors
translated. `room-state-breakdown` is a proper exhaustive registry (fails loud on
an unbucketed status), domain logic correctly in `lib/`, `roomHasHealthConcern`
limited to degraded+halted. Beacon aggregation counts sticky/halted only. i18n
EN+PL complete for all new keys, full Polish words, no raw HTTP/GGG codes shown.
No new `useEffect` (no cleanup surface), no inline styles, responsive `flex-wrap`.

**Consistency:** D-deg-1..5 and D-ph-1..3 honored (three families correctly
distinguished; option-B toggle; realized on legacy `EngineStatus` + new `halted`,
rename correctly parked; single derivation point). CHANGELOG `[Unreleased]` +
CLAUDE.md manifest landed in-commit; English throughout; `api-notes.md` untouched
(no new GGG-shape assumption); no `fetch` to GGG added.

**Testing CLEAN:** flap detector (2 masked / 3rd sticky), sticky survives
reconnect + mid-window drop resets countdown, backoff rung 0 fires / rung 1
holds, halt boundary, own-toggle revival from halted, blind-family (`no-session`)
self-heal, transient poll error/rate-limited → active, manual restart clears
slate, bootstrap reconcile (room-off → paused / disabled → stopped), mid-drip
gate races, all six SEC-1 Origin cases, room-state-breakdown exhaustive counts.

## Scope not reached (per-agent SCOPE notes)

- No agent ran the full suite (baseline GREEN: server 423 / web 165 / desktop 11);
  tests read against source, no ABI flip performed.
- `review-browser` not used — no runtime/in-browser verification of the toggle
  tones, beacon, or RoomSection interaction; F8/F9/F10 are static inferences.
- `guard-halted` blind-skip branch and the ladder last-rung cap are logically
  verified but not pinned by a test (see F4-family test gaps; minor).
- The wisdom of recycling a `ws-rate-limited` (1013) socket every ladder rung vs.
  the ws engine's own `WS_RATE_LIMIT_BACKOFF_MS` was flagged out-of-lane by
  reliability — a policy question for the plan owner, not a defect here.

---

## Accepted / deferred

Nothing deferred. **F1 (S2) blocks** — no owner/ticket deferral requested; must be
fixed before merge. F6 + F11 recommended to ship with F1 (one defect class). F7
recommended as a tracked park (health-module extraction). All S4s batchable.

**Owner:** Bartosz to decide fix-vs-defer per item.

---

## Applied — 2026-07-10 (same session, operator: "implement all")

Every actionable finding fixed with a test; the three findings whose OWN
recommendation was to park are parked as recommended.

- **F1 (S2) + F6 + F11** — durable `health.halted` marker: `publishEngineStatus`
  re-derives a running-ish status to `'halted'` while set (precedence over the
  sticky→degraded rewrite); `startPendingWatchers` / the in-flight drip loop key
  their exclusion off `health.halted` (not the display status, which reads
  `paused` while a gate holds it); `freshHealth()` still clears it for
  Restart / own-toggle revival. Extracted `isEligibleToRun(watcher)` and reused
  it at sweep / global-pause / windDownForGuard / drip-filter / drip-loop. Global
  resume now re-asserts the halted display. Tests: bulk room+global reopen does
  NOT revive halted (F11), held-outranks round-trip keeps `degradedSince` (F12),
  import-into-disabled-room lands held (F13).
- **F2** — per-watcher try/catch in the sweep + `.catch` on the interval tick +
  a process-level `unhandledRejection`/`uncaughtException` backstop in
  `server.ts` (also closes full-review REL-1), covering standalone + in-process.
- **F3** — recovery clock re-seeded on gate reopen (room + global).
- **F4** — sweep skips a recovery restart while a mass drip holds the
  `startingWatchers` latch.
- **F5** — beacon requires `status==='degraded' && degradedSince` (or halted),
  so a gate-held search no longer lights it.
- **F8/F17** — beacon is a `role="status"` + `aria-label` wrapper around the
  `Badge` atom (decorative dot `aria-hidden`).
- **F9** — breakdown cluster renders a `<button>` only under a health concern,
  else inert `<span>` (no dead tab stop / click-swallow); dead `data-no-expand`
  dropped.
- **F10** — row `STATUS_TONES.degraded → 'warn'`; `halted` stays the lone danger.
- **F12/F13** — added (above).
- **F14** — host-guard dead `::1` branch removed + comment corrected.
- **F16** — recovery/halt logs now carry `correlationId`.
- **F18** — `actionBusy` also disables Archive/Delete.
- **F19** — dead `rooms.degradedCount` plural keys deleted (EN+PL).

**Parked per the finding's own recommendation:** **F7** (health-module
extraction — deliberately out of this blast radius; the file is ~2k lines,
tracked for a dedicated refactor), **F15** (ladder jitter — defused by the
`startingWatchers` latch; revisit only if field resync is seen), **F20**
(`'polling (recovered)'` const-extract — only 2 sites, extract on a 3rd).

**Open policy question surfaced (not a defect):** recycling a `ws-rate-limited`
(1013) socket every recovery rung vs. deferring to the ws engine's own
`WS_RATE_LIMIT_BACKOFF_MS` — a plan-owner decision, left as-is.

Verify GREEN after fixes: server 426, web 165, desktop 11, lint + typecheck.
