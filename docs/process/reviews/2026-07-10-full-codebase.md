# Full-codebase review — 2026-07-10

**Scope:** entire working tree of `poe-trade-sniper` as it stood on 2026-07-10,
**including the uncommitted plan-43 "sticky degraded + timed recovery" feature**
(16 modified files + `docs/planning/43_degraded_handling.md`, untracked). Branch
`main`, 4 commits ahead of `origin/main`, working tree otherwise the shipped
Phases 1–4 + deal-watch + operator-UX build. Static review only — the app was
not run, no live GGG endpoints touched, no browser tools (per operator request).

**Reviewers (8, parallel):** security, correctness, architecture, consistency,
testing, performance, reliability, frontend. Every finding was routed through
`review-verifier` (adversarial refute pass) before consolidation; severities
below are the verifier's corrected values, not the specialists' originals.

**Automated gate:** `pnpm verify` baseline reported GREEN within the hour before
the review (server 414 / web 161 / desktop 11 tests, lint + typecheck clean); not
re-proven. `pnpm audit` / gitleaks / e2e were not re-run in this pass.

---

## Verdict: BLOCKED

One confirmed **S2** remains un-deferred: **SEC-1** (loopback API has no
Origin/CSRF defence; plan-43's new bodyless `POST /searches/:id/restart` extends
the reachable side-effect surface). S2 blocks the push unless explicitly deferred
with an owner + ticket. No S1. Everything else is S3/S4 (track or batch).

The plan-43 feature itself is **functionally sound** — correctness, reliability,
and consistency all confirmed the state machine matches D-deg-1..5 (families,
flap detector, stability window, backoff ladder, blind-family skip, runtime-only
health, deal-swap carry). The blocker is a pre-existing platform gap the new
endpoint widens; the rest are polish, observability, test-coverage, and one
UX-correctness bug (BEACON).

### Severity summary

| Severity | Count | IDs                                                                                                         |
| -------- | ----- | ----------------------------------------------------------------------------------------------------------- |
| S1       | 0     | —                                                                                                           |
| S2       | 1     | SEC-1                                                                                                       |
| S3       | 13    | REL-1, SEC-2, REL-2, PERF-1, BEACON, ARCH-1, ARCH-2, FE-2, FE-4, TEST-1, TEST-4, TEST-5, TEST-7             |
| S4       | 15    | REL-3, REL-4, PERF-2, PERF-3, PERF-4, COR-1, ARCH-3, ARCH-5, FE-1, FE-3, FE-5, FE-6, TEST-2, TEST-3, TEST-8 |
| Refuted  | 1     | COR-2 (prod-unreachable)                                                                                    |

---

## S2 — blocks merge

### SEC-1 · `apps/server/src/api/host-guard.middleware.ts:13` (whole API surface; new instance `apps/server/src/api/searches.controller.ts:244`)

**What:** `HostGuardMiddleware` validates only the `Host` header (DNS-rebinding
defence). There is no `Origin` / `Sec-Fetch-Site` check, no `enableCors`
restriction, and the default `express.urlencoded` body parser is left on. A
cross-site page the operator visits in web mode can issue a CORS-"simple"
(bodyless or `application/x-www-form-urlencoded`) `POST` to
`http://localhost:3500/api/...` — it passes HostGuard, triggers no preflight, and
executes the side effect. The no-CORS posture only blocks _reading_ the response,
not the mutation.
**Why:** the reachable bodyless state-changers are load-bearing —
`POST /searches/:id/restart` (plan-43, new: recycles detection engines),
`POST /guard/reset` (re-arms the OutboundGuard — the load-bearing safety valve),
`POST /searches` (adds a GGG-hitting search), `POST /session/login/start` (spawns
Chrome). A drive-by page can clear the safety guard, recycle engines, and
generate GGG traffic — driving the operator's **real** PoE account toward a
stacked lockout (hard rule #4) or a detection blackout during a live snipe.
**Fix:** in `HostGuardMiddleware`, additionally reject any request whose `Origin`
(when present) is not a loopback origin — allow `http://localhost:*`,
`http://127.0.0.1:*`, `[::1]`, and no-Origin same-origin navigations; 403 the
rest. The web client uses relative `/api` paths and the Vite dev proxy preserves
a loopback origin, so this is non-breaking. Optional defence-in-depth: require a
custom `X-Requested-By` header to force a preflight on body-carrying routes.

---

## S3 — fix in PR or track

### REL-1 · `apps/server/src/search/search-manager.ts:1212-1262` (downgraded S2→S3)

Scheduler tick hardening gap. `runSchedulerTick` has `try/finally` with **no
`catch`**; only `pollEngine.tick()` is individually guarded, so
`sweepStickyDegraded()`, `startPendingWatchers()`, and `windDownForGuard()` run
unguarded. The tick is launched `void this.runSchedulerTick()` and there is **no
`process.on('unhandledRejection'|'uncaughtException')`** handler anywhere in
`main.ts`/`server.ts`. On Node 24 an unhandled rejection terminates the process,
which would take detection down for all ~24 searches. Downgraded from S2 because
no concrete reachable synchronous throw was demonstrated (the known-throwing path
— poll `tick()` — _is_ caught). Real hardening gap, not a demonstrated crash.
**Fix:** wrap the whole tick body in `try/catch` (log + continue), give the
`sweepStickyDegraded` for-loop a per-watcher `try/catch`, add a process-level
`unhandledRejection` backstop in `server.ts`.

### SEC-2 · `apps/server/src/dev/dev.controller.ts:67,75,115`

Dev-only bodyless `POST`s (`move-test`, `capture-probe`,
`return-hideout-probe` → synthetic input + character teleport) share the SEC-1
cross-origin vector. `DevModule` is registered only when
`APP_ENV==='development'`, so it is not a production hole, but during on-Mac
validation with a browser open a visited page could trigger synthetic input / a
teleport (hard rule #5 territory). **Fix:** covered transitively by the SEC-1
Origin check (applies app-wide, dev routes included) — no separate change needed.

### REL-2 · `apps/server/src/search/search-manager.ts:1288-1303,1324,1462`

Degrade/recovery transitions are under-observable. Recovery + "recovered" logs
carry `watcher.row.id` but **not** `watcher.correlationId` (violates the
"correlation id threads every leg" invariant); `enterStickyDegraded` (the
alertable "went degraded overnight" event) emits **no log line** at all;
`windDownForGuard` halts every watcher **silently**. These are exactly what an
operator greps for after a bad night. **Fix:** add `correlationId` to the
sweep/clear logs, a structured log on entry in `enterStickyDegraded`, and a
summary log in `windDownForGuard`.

### PERF-1 · `apps/server/src/db/schema.ts:134` + `apps/server/src/activity/activity.service.ts:187`

The `activity` table has **no retention/pruning** — the only log-like table that
lacks it (`hits` → `HITS_MAX_ROWS`, `price_check_history`,
`deal_baseline_history` are all capped). Every travel→buy→return upserts a
permanent multi-KB row (item + steps + price JSON); over months of auto-buy this
grows unbounded, and `listActivity` filters on an un-indexed `outcome` +
leading-wildcard `LIKE` that degrades as the table grows. Violates the
architecture.md "bounded growth" invariant. **Fix:** add an `ACTIVITY_MAX_ROWS`
Zod tunable + a prune mirroring `pruneHits` (`DELETE ... WHERE id NOT IN newest-N`),
called after terminal `persist()` and on boot.

### BEACON · `apps/web/src/shell/AppShell.tsx:94` + `apps/web/src/shell/AppBar.tsx:67` (converged from 4 reviewers)

The app-wide degraded beacon (AppShell count) and the AppBar pill count
`search.status === 'degraded'`, which the server also sets on **transient
throughput degrades** (`rate-limited`, transient `error`) that plan-43 §2 defines
as self-healing / NOT sticky. The field's own JSDoc claims "sticky-degraded". The
server already exposes `degradedSince` (populated only while sticky) as the
precise discriminator, and the "degraded for Xm" row text uses it correctly. So
with ~24 live searches a routine governor pause lights the app-wide "something is
wrong" beacon **daily** — the exact flap-noise the feature set out to suppress.
Adjudicated **S3** (defeats the feature's core promise; UX-only, no data impact).
**Fix:** count `search.degradedSince !== null` in AppShell + AppBar (data is
already on the wire). Note: the RoomSection chip counting any-degraded _is_ per
doc §5 ("any member degraded") — leave it. Extracting a shared
`isStickyDegraded(search)` predicate (and a testable
`deriveDetectionPosture(searches)`) resolves this + TEST-8 together.

### ARCH-1 · `apps/server/src/search/search-manager.ts` (1972 lines)

God-file growth. The file is now the largest in the repo (+191 from plan-43) and
owns ~10 responsibilities (search CRUD, rooms, import/export, hits, deal
integration, scheduler, engine lifecycle, status derivation, auto-travel/buy
gating, and now the sticky-degraded state machine). The health machine itself is
cohesive — the SRP problem is grafting it onto an overloaded class rather than
extracting it. **Refactor:** lift a `search/health/` module (`WatcherHealth`,
`freshHealth`, family classification, flap window, pure should-restart/should-clear
decisions) that `SearchManager` calls; keep only the engine-recycle side effects
in the manager. **Tradeoff:** a new collaborator / more indirection; state still
lives on `Watcher` so the tracker is mostly pure functions. Do now while the code
is fresh; park the rooms/deal splits behind a tracked follow-up.

### ARCH-2 · `apps/server/src/search/search-manager.ts:1246-1252,1487,1531,1552`

The plan's claimed "one derivation point (`publishEngineStatus` wrapper), no
scattered status writes" is **not** implemented. `publishEngineStatus` (~1675) is
a dumb setter; the "sticky must not be talked over by 'active'" rule is
re-implemented at **four** separate call sites. **Refactor:** push the rule into
the setter — `if (health.stickyDegraded && status==='active'){ status='degraded';
detail=health.lastDetail; }`. `clearStickyDegraded` resets health before
publishing so it flows through cleanly; the three ad-hoc early-returns collapse.
Load-bearing to the feature's correctness — do with ARCH-1.

### FE-2 · `apps/web/src/components/search-panel/SettingsCard.tsx:122`

The new "Restart detection" `Button` (and the adjacent Archive button) call
`run(onRestart)` with **no in-flight/disabled guard** — a double-click
double-POSTs a full engine recycle, spending extra ws-connects against the guard
budget. Contrast the Save button, guarded by `saving`/`canSave`. **Fix:** local
`restarting` state → `disabled={restarting}` set/cleared around `run(onRestart)`.

### FE-4 · `apps/web/src/components/search-panel/SettingsCard.tsx:120-135`

Responsive gap. The lifecycle bar (`flex justify-between`, no `flex-wrap`) now
holds four controls (Restart / Archive / Delete / Save); with long PL labels
("Zrestartuj wykrywanie", "Archiwizuj", "Usuń", "Zapisz") it overflows
horizontally on phone widths while the field grid above already stacks. **Fix:**
add `flex-wrap gap-y-2` and let the left group wrap.

### TEST-1 · `apps/server/src/search/search-manager.test.ts` (blind-family skip)

The blind-family skip (`no-session`/`guard-halted` NOT recovery-restarted while
the gate is down) — the one failure path plan-43 P1 explicitly promised a test
for, and the one that touches the load-bearing governor (pointless GGG spend
during a lockout) — is untested. **Fix:** a case driving a watcher sticky via
`onStatus('degraded','no-session')`, advancing past a rung, asserting the engine
count did NOT grow; plus the complement (gate lifts → stability window applies).

### TEST-4 · `apps/server/src/config/env.test.ts` (`DEGRADED_RESTART_BACKOFF_MS`)

The only non-trivial parse in the batch (regex-validate a CSV, then
`.split(',').map(Number)` → `number[]`) is untested. A loosened regex would
silently yield `[NaN]`. **Fix:** assert the default parses to
`[300000,600000,1800000]` and a bad value (e.g. `'300000,abc'`) throws.

### TEST-5 · `apps/server/src/search/search-manager.ts:1245-1252` (transient-error lingering fix)

The manager's own `hadTransientError` branch (poll tick throws `error`, next good
tick republishes `active`) is untested — the existing case only covers the
poll-engine `rate-limited` recovery twin. **Fix:** a case where a poll tick
throws → `degraded`/`error`, then a clean tick recovers to `active`.

### TEST-7 · `apps/web/src/lib/relative-time.ts` (`formatRelativeMagnitude`)

Entirely untested (no `relative-time.test.ts`), and plan-43 adds a new consumer
(`SearchesPage.tsx:674`, "degraded for 23m"). Exactly the kind of pure `lib/`
formatter the project unit-tests. **Fix:** a small table test (seconds / minutes /
hours / days boundaries).

---

## S4 — batch, non-blocking

- **REL-3** · `search-manager.ts:1512` — `health.wsDrops` pushed unconditionally
  (incl. while already sticky and on every ~1s no-session retry); window-filtered
  so bounded (~600 × 24), trivial memory. Skip the push once `stickyDegraded` is
  latched.
- **REL-4** · `apps/server/src/engines/ws-engine.ts:104-111` — no-session branch
  reschedules every ~1s indefinitely, re-entering sticky + emitting an SSE
  `engine-status` frame each time (~1 frame/search/s while logged out). Back the
  no-session retry onto the reconnect ladder or dedupe the emit. Pre-existing.
- **PERF-2** · `activity.service.ts:170` — `snapshotItem` looks up `hits` by
  `listingId` with no covering index; composite index narrows it when `searchId`
  is present, full-scan (bounded 10k) only on the searchId-null path. Add a
  `hits(listing_id)` index if kept.
- **PERF-3** · `search-manager.ts:1951` — `publishSearchesChanged` rebroadcasts
  all watcher rows (full filters JSON) on single-row events (hourly market /
  frequent deal updates). Modest at 24 rows; consider a targeted `search-updated`
  event for per-row changes.
- **PERF-4** · `apps/server/src/search/live-offer-registry.ts:47` — per-entry
  `listingIds: Set` is unbounded (the `offers` Map is FIFO-capped, but a
  persistently re-served offer never evicts and its id set grows). Cap the
  per-entry set (newest K) or evict by age.
- **COR-1** · `search-manager.ts:1257` vs `:1552` — during an active sticky
  episode a poll-coverage tick throw publishes `('degraded','error')`, and
  because `hadTransientError` is `!stickyDegraded`-gated and steady ticks are
  status-silent, the row lingers showing detail `error` instead of the sticky
  detail (e.g. `ws-unstable`) until the next poll status event. State stays
  `degraded` — cosmetic detail-string bug. Skip the `error` relabel in the catch
  when `stickyDegraded` (resolved for free by the ARCH-2 refactor).
- **ARCH-3** · `search-manager.ts:1296,1519` (downgraded S3→S4) — the blind pair
  `'no-session'||'guard-halted'` is written twice; two instances is below the
  project's own 3+ radar threshold. Fold into a family resolver if/when a 3rd
  site appears.
- **ARCH-5** · `search-manager.ts:115` — `WatcherHealth.lastDetail` typed `string`
  not `EngineStatusDetailCode | null` (plan §1 specced the enum); the
  `'ws-unstable'` literal compiles unchecked. Narrow the type.
- **FE-1** · `apps/web/src/i18n/messages.ts:116` (downgraded S3→S4) —
  `detection.degradedTitle` hand-builds a plural (`'search(es)'`) inside a
  singular `t()`; the PL string hard-codes genitive `wyszukiwań` (wrong for count
  1). Tooltip-only. Promote to a plural key consumed via `tn()`.
- **FE-3** · `apps/web/src/shell/AppBar.tsx:67-75` (downgraded S3→S4) — the
  degraded pill is a bespoke `<span>` duplicating `ModePill`/`Badge` structure
  (2nd instance, below the extract threshold; tones are semantic tokens, not raw
  hex). Extend `ModePill` into a `StatusPill` tone-enum if a 3rd pill appears.
- **FE-5** · `apps/web/src/components/RoomSection.tsx:188` — the collapsed-room
  degraded chip is a focusable `<button cursor-pointer>` whose `onClick` is a
  no-op when the room is already expanded — a dead control for keyboard/AT. Render
  the interactive `<button>` only when `collapsed`; a bare `<Badge>` otherwise.
- **FE-6** · `apps/web/src/shell/AppBar.tsx:71-74` — the pill renders a bare
  number on a non-focusable `<span>` with meaning only in `title`; a screen
  reader announces just the number. Add an `aria-label` (folds into the FE-3
  StatusPill extraction).
- **TEST-2** · (downgraded S3→S4) `POST /api/searches/:id/restart` route untested;
  the manager `restartSearch` IS tested and the delegation is a one-liner.
- **TEST-3** · (downgraded S3→S4) health-survives-deal-id-swap
  (`newWatcher.health = watcher.health`) untested; adjacent engine-status
  preservation IS tested.
- **TEST-8** · (downgraded S3→S4) AppShell/RoomSection degraded-count derivations
  are inline + untested; the real fix is correcting (BEACON) + extracting them
  for testability.

---

## Verified-safe (aggregated CLEAN lists)

**Security (positively verified):**

- Session credential (hard rule #3) — cookie values / User-Agent never logged,
  never serialized to any API response. `SessionService.publicStatus()` returns
  only `cookieNames` + `capturedAt` + `probedValid`. Grep for cookie/POESESSID/UA
  logging came back clean.
- Egress discipline (hard rule #4) — only `trade-api/` + the live `ws-engine`
  reach pathofexile.com, both with the session header + governor/guard. The other
  two `fetch`es are GitHub Releases (config-pinned) and the loopback Chrome
  DevTools port (login capture) — neither touches GGG.
- Secret at rest — AES-256-GCM, per-message random 12-byte IV, key from OS
  keychain / Electron safeStorage; loud documented plaintext fallback. CSPRNG for
  keys/ids; `Math.random` only for jitter/ports/pixel-wobble.
- Export/import — reads only credential-free tables; CSV RFC-4180 quoted +
  formula-injection guarded; import `.strict()` Zod, re-mints ids, discards
  runtime state.
- Injection — all DB access via Drizzle; every `sql``` interpolation binds `${}`;
no `sql.raw` with user input. API edges strict-Zod validated.
- Electron hardening — `contextIsolation:true`, `nodeIntegration:false`,
  `sandbox:true`; `setWindowOpenHandler` denies + routes to OS browser;
  `will-navigate` compares parsed origins. Preload exposes only a narrow
  permission bridge + a price-check result event; no secret crosses IPC.
- Server binding defaults to `127.0.0.1` (loopback), not `0.0.0.0`.
- Error leakage — raw GGG/HTTP detail stays in logs; UI status reduced to an
  `EngineStatusDetailCode` enum → i18n; plan-43's new `ws-unstable` follows the
  same path.

**Plan-43 correctness / reliability / consistency (confirmed matches the spec):**

- Backoff-ladder Zod parse — regex guarantees ≥1 digit group; `map(Number)` never
  empty, `Math.min(attempts, len-1)` never `-1`; no `NaN`. Config defaults match
  the doc table exactly (3 / 600000 / 300000,600000,1800000 / 300000).
- Double-recovery interplay (poll `lastTickRateLimited` vs manager
  `hadTransientError`) — disjoint by detail code; cannot both fire; no
  double-publish.
- Flap detector — ws-engine emits exactly one `degraded` per close; sliding
  window filtered; `degradedSince ??=` + `!alreadySticky` seeding keep the
  recovery clock stable under continued flapping.
- Sweep branch ordering — stability-clear before recovery-restart;
  `wsConnected || wsEngine===null` gates correctly; blind-family skip consistent.
- Deal id-swap health carry (`newWatcher.health = watcher.health`) — no amnesty of
  a sick search; `restartViaDrip(preserveStatus)` keeps `degraded` through the
  reconnect.
- `windDownForGuard` now enters sticky `guard-halted` + adds `roomEnabled` to
  `intendedRunning` — room-paused watchers no longer falsely degrade on a guard trip.
- Blind-family recovery is NOT a dead-end — the _clear_ branch does not skip
  no-session/guard-halted; both have a real path back to `active` once the gate
  lifts (ws self-retry / post-guard `startPendingWatchers`).
- `restartSearch` vs sweep — single-threaded, `startingWatchers` re-entrancy gate
  - per-start identity re-check + `freshHealth()` prevent double engines.
- Engine/socket/timer teardown — `stopEngines` first on every recycle; no leak
  across repeated `restartViaDrip`. SSE unsubscribes + clears heartbeat on
  disconnect; `RealtimeBus.publish` isolates a throwing subscriber.
- Outbound GGG calls carry `AbortSignal.timeout(OUTBOUND_TIMEOUT_MS)`.
- D-deg-5 runtime-only health — no schema/migration change. P3 (notifications /
  activity entries / Settings knobs) correctly NOT implemented (parked).
- i18n parity — all 5 new keys present in EN (`as const` → `MessageKey`) + PL
  (`Record<MessageKey,string>`); `rooms.degradedCount` plural in EN {one,other} +
  PL {one,few,many,other}; `{count}`/`{time}` vars match. No hardcoded strings.
- API-contract fidelity — `degradedSince` + `ws-unstable` added in
  `packages/shared` (single source), consumed client-side; controller fixture
  updated; no client/server drift.

**Performance / DB (verified):** no synchronized reconnect stampede (drip +
`startWatchersStaggered` + guard budget de-sync recovery restarts); seen-id sets
bounded (`SEEN_IDS_CAP`); `hits` / `price_check_history` / `deal_baseline_history`
pruned; no N+1 on `GET /api/searches`; forward-only `ADD COLUMN` migrations
(metadata-only); paginated list endpoints (Zod-capped limits).

**Testing (verified):** the 6 new `search-manager.test.ts` cases assert intent
(red-before / green-after), not re-stamps; no `.only`/`.skip`; governor math,
guard, header parsing, item normalization, deal baseline/query, travel, ws/poll
engines all covered with mocked IO + hand-computed expectations.

**Frontend (verified):** effect cleanup on the `nowMs` interval + `AddSearchForm`
listener; `degradedSince` duration pure (clock passed in); client secret hygiene
intact (no touched file reads/renders/persists the session).

---

## Coverage gaps (aggregated SCOPE — what was NOT reached)

Static review only; `pnpm verify` / e2e / the app were not run (baseline taken as
GREEN). Areas each specialist flagged as sampled-not-exhaustive or out-of-lane:

- **Correctness** swept the whole repo only by sampling — `trade-api/*` (governor,
  client, purchase-mode), `guard/*`, deal-watch service/schemas, `apps/desktop/*`
  (Electron / native capture / input), migrations/db layer, and `apps/web` beyond
  the plan-43-touched components carry **no correctness claim** from this pass.
- **Security** did not inspect `node_modules`/lockfile provenance (dependency
  supply chain) and read price-check clipboard→trade2 query construction
  (`query-from-filters.ts`, `stat-matcher.ts`) only at the SQL/regex level, not
  for full parse-logic correctness.
- **Performance** made index/plan claims by static reasoning over the Drizzle
  schema + queries — no `EXPLAIN` run.
- **Reliability** confirmed no cookie/UA in the new logs but deferred the secret-
  policy review to security; DB indexing/cost to performance.
- No specialist executed the test suite (better-sqlite3 is on the Electron ABI;
  flipping it was deemed too disruptive for a static pass).
- **Not re-audited (known-parked, per operator):** poe2scout price-check name
  lookups degraded; Phase 5 packaging; P0.2b id-aging evidence; native
  capture/input on-Mac hardware validation.

---

## Refuted

- **COR-2** · `search-manager.ts:~1284-1296` — a watcher with no ws engine for its
  whole life never auto-clears sticky. Real as written, but **not reachable in
  production**: the engine registry is always `[WsEngine, PollEngine]`, `wsEngine`
  is only transiently null, and the only ws-less sticky entry (`guard-halted`) is
  the branch already skipped. Test-config edge only — optionally hardened by
  letting the clear branch also fire on `wsEngine===null && pollEngine` healthy.

---

## Pre-commit gates (not review findings — required before the plan-43 commit)

These are correctly absent _because the feature is uncommitted_; call them out on
the commit gate, not as bugs:

1. **`CHANGELOG.md [Unreleased]`** — no plan-43 entry yet. The feature adds
   user-facing surface (Restart-detection button, degraded app-bar beacon,
   collapsed-room degraded chip, `ws-unstable` detail, "degraded for Xm"). Per
   hard rule #6 + the conventions changelog rule, an entry is required in the same
   commit.
2. **`CLAUDE.md` "State of the build"** — doesn't yet mention plan 43. Update it
   alongside the commit for session continuity. The decision record itself
   (`docs/planning/43_degraded_handling.md`, D-deg-1..5) is present and accurate.
3. **`pnpm verify` (and ideally `verify:full`)** green with the plan-43 changes
   staged — the baseline predates the working-tree edits.

---

## Recommendation (owner: Bartosz — solo dev)

**Must fix before the next push (unblock the S2):**

- **SEC-1** — add the loopback `Origin` check to `HostGuardMiddleware`. Small,
  non-breaking, closes the CSRF hole and transitively covers SEC-2. This is the
  only merge blocker.

**Strongly recommended in the same PR (cheap, high-value, and they cluster):**

- **BEACON** — one-line-ish switch to `degradedSince !== null` in AppShell +
  AppBar; without it the feature's flap-suppression is defeated daily. Extract
  `isStickyDegraded` + `deriveDetectionPosture` to also close **TEST-8**.
- **FE-2** — in-flight guard on the Restart button (double-recycle burns guard
  budget).
- **ARCH-2 + COR-1** — push the sticky rule into `publishEngineStatus` (collapses
  4 scattered guards and fixes the lingering-`error` cosmetic in one move); pairs
  naturally with the **ARCH-1** health-module extraction while the code is fresh.
- **TEST-1 / TEST-4 / TEST-5 / TEST-7** — the four promised-but-missing tests
  (blind-family skip, backoff-ladder Zod, transient-error lingering fix,
  `formatRelativeMagnitude`).

**Track (S3/S4, non-blocking):** REL-1 (process-level `unhandledRejection`
backstop + tick catch — cheap resilience, worth doing soon given overnight runs),
REL-2 (correlation-id + entry logs), PERF-1 (`ACTIVITY_MAX_ROWS` prune), FE-4
(responsive `flex-wrap`), and the remaining S4 polish batch.

**Verdict: BLOCKED on SEC-1.** Defer only with an explicit ticket + owner; S1/S2
are otherwise merge-blocking by policy.
