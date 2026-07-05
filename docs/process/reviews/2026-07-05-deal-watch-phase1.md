# Review — deal-watch Phase 1 (server core) — 2026-07-05

**Scope:** the entire uncommitted working-tree diff vs `HEAD` (`3c567b0`) — deal-watch
Phase 1 server core for [`docs/planning/41_deal_watch_plan.md`](../../planning/41_deal_watch_plan.md).
30 changed files + 21 new files (deal-watch module, market-data extraction, migrations
0011/0012, SearchManager seam, decorator registry, export v4, shared types, live-hits
plumbing). Web (Phase 2) is out of phase and correctly absent.

**Verdict: BLOCKED** — 2 confirmed **S2** remain, both un-deferred (no S1). A single-operator
local app, but both S2s are reachable in routine states. Nothing to fix in this pass —
report only; Bartosz decides fix-vs-defer.

**Method:** `pnpm verify` gate → project standards injected → 8 specialists in parallel
(security, correctness, architecture, consistency, testing, performance, reliability,
frontend) → every finding routed through 2 `review-verifier` passes → S1–S4 gating.
`review-browser` was not run: no runnable new UI in this phase.

## Gate

- `pnpm verify` (lint + typecheck + test): **green** (exit 0). Raw stdout was swallowed by
  the background redirect; the `&&` chain guarantees all three stages passed.
- `ci-scan` equivalents (format check, `pnpm audit`, gitleaks) run pre-push/CI, not re-run
  here; no scanner was skipped silently.

## Summary table

| ID      | Sev    | File:line                                                                 | Theme                                                                            |
| ------- | ------ | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| F1      | **S2** | deal-watch.service.ts:303-318                                             | `enable`/`manualRefresh` hang the HTTP request while paused / guard-tripped      |
| F3      | **S2** | import.service.ts + search-manager.ts:812-877 + deal-watch.service.ts:177 | `DEAL_MAX_WATCHES` bypassed by import + boot re-queue                            |
| F2      | S3     | search-manager.ts:442 vs deal-watch.service.ts:562                        | DELETE leaks in-memory maps + orphan history until boot                          |
| F4      | S3     | deal-watch.service.ts:322-325/382/471                                     | non-429 GGG error → no `derive-failed`, 30 s retry storm                         |
| F5      | S3     | deal-watch.service.ts:460-469                                             | flat-market id-age re-derive is a permanent no-op                                |
| F6      | S3     | deal-watch.service.ts:235-259                                             | `disable()` races an in-flight re-derive → 500 + still-enabled                   |
| F7      | S3     | deal-watch.service.ts:376                                                 | expiry-probe stale write reverts a concurrent threshold edit                     |
| F8      | S3     | search-manager.ts:777-788 + import.service.ts:90                          | export/import reuses `watchId` → collision on re-import                          |
| F9      | S3     | deal-baseline.service.ts:97                                               | baseline gate `survivors < MIN_SAMPLE` stricter than D-dw-2 (`== 0`)             |
| F10     | S3     | deal-baseline.service.ts:110                                              | `rawLowestExalted` stores cheapest _survivor_, not raw lowest                    |
| F12     | S3     | currency-rate.service.ts / deal-baseline:121 / deal-hit.decorator:77      | currency conversion 3× + dead `CurrencyRateService`                              |
| F13     | S3     | deal-watch.service.ts:367-380 + :471                                      | expiry probe + re-derive POST spend outside the headroom reserve                 |
| F14     | S3     | deal-watch.service.ts:245-287                                             | `disable`/restore fires GGG calls while globally paused                          |
| F17a    | S3     | deal-watch.service.test.ts / search-manager.test.ts                       | `swapDealSearch` real-guard + list-order untested                                |
| F17b    | S3     | search-manager.test.ts                                                    | id-edit 409 rejection while deal-mode on untested                                |
| F17c    | S3     | search-manager.test.ts                                                    | `recordHits`→decorator integration (deal col + suppression) untested             |
| F17e    | S3     | deal-watch.service.test.ts                                                | budget-low/rate-limited + post-await id-changed bail untested                    |
| F17f    | S3     | deal-watch.service.test.ts                                                | queue coalescing + same-cap no-op untested                                       |
| F17g    | S3     | deal-watch.service.test.ts                                                | guard/pause queue no-op untested                                                 |
| F17h    | S3     | deal-baseline.service.test.ts                                             | even-length median untested (borderline S4)                                      |
| F11     | S4     | search-manager.ts:1572                                                    | `deal_watch` read via bare cast, no zod-at-read                                  |
| F15     | S4     | deal-watch.service.ts:117-120                                             | queue-tick body has no try/catch (no concrete throw path)                        |
| F16     | S4     | deal-watch.service.ts:371/382/471                                         | correlation id not threaded across a deal op's legs                              |
| F17d    | S4     | export.service.test.ts                                                    | redundant export-side runtime-nulling untested (functional path IS covered)      |
| F19     | S4     | deal-watch.service.ts:61                                                  | `QUEUE_TICK_MS` magic number (not in env schema)                                 |
| F21     | S4     | search-manager.ts:~1283                                                   | decorations built outside the insert-tx try (latent; decorator throw-safe today) |
| F22     | S4     | deal-watch.service.ts:148                                                 | `manualRefresh` doesn't skip archived/disabled rows                              |
| F23     | S4     | deal-watch.ts:40 / deal-watch.service.ts:177                              | dead `'capped'` status (enable throws 409 instead)                               |
| F24     | S4     | migration 0012 / deal-history.service.ts                                  | index `(watch_id, computed_at)` 2nd col unused (queries order by `id`)           |
| F25     | S4     | deal-watch.service.ts:50-58                                               | `DealJobKind` vestigial (processJob never branches on `kind`)                    |
| F26     | S4     | deal-watch.service.ts:393-399                                             | budget-low pushes `nextRefreshAt` a full ~1 h                                    |
| F27     | S4     | deal-watch.service.ts:177                                                 | cap counts archived/disabled deal rows (over-conservative)                       |
| F28     | S4     | searches.controller.ts:158-160                                            | combined `PATCH {input, dealWatch}` silently drops `dealWatch`                   |
| F29     | S4     | docs/planning/41 §Config                                                  | table omits `DEAL_BASELINE_HISTORY_MAX`                                          |
| ~~F18~~ | —      | searches.controller.ts:40                                                 | **REFUTED** — no-`.strict()` is consistent with the controller pattern           |
| ~~F20~~ | —      | deal-watch.service.ts:393-421                                             | **REFUTED** — TS narrowing already enforces exhaustiveness                       |
| ~~F30~~ | —      | CHANGELOG.md                                                              | **REFUTED** — user-facing changelog entry belongs with Phase 2 UI                |

## Findings (verified)

### S2 — blocking

**F1 · S2 · `apps/server/src/deal-watch/deal-watch.service.ts:303-318` (+ :157, :203)**
`enqueueAndWait` never resolves when `runQueue` early-returns on
`this.guard.tripped || isDetectionGloballyPaused()` (line 318) — the job stays in
`pendingJobs`, its `settlers` never fire. Both `enable()` (`:203`) and `manualRefresh()`
(`:157`) `await` it. So enabling deal mode or hitting `POST /deal-refresh` **while detection
is globally paused (a routine operator state) or the OutboundGuard is latched-tripped** hangs
the HTTP request with no server timeout. Pause self-heals within one 30 s tick; a guard trip
is latched until manual reset, so the hang is effectively unbounded.
_Fix:_ when the queue declines to run, settle the pending jobs (return the already-persisted
`pending-derive` status) instead of leaving awaiters hanging — don't block the request path
on a paused/tripped queue.
_Verifier:_ CONFIRM · S2.

**F3 · S2 · `apps/server/src/export-import/import.service.ts` + `apps/server/src/search/search-manager.ts:812-877` + `deal-watch.service.ts:177`**
`DEAL_MAX_WATCHES` is enforced **only** at interactive `enable`. `importSearches` (up to 2000
rows, each may carry `dealWatch`) and the boot re-queue (`onApplicationBootstrap:107-121`)
apply no cap, so an import — or repeated appends of legitimate ≤10-watch files — creates
`> cap` enabled deal rows, all re-entering the re-derive queue and opening live ws sockets
against the **unprobed** GGG socket tolerance (P0.6; hard rule #4 — lockouts stack). A missing
safety-limit on a non-interactive path; the enumerated `capped` status is never used.
_Fix:_ enforce the cap on the import + boot paths (coerce overflow rows to status `capped`
and skip their derive).
_Verifier:_ CONFIRM · S2.

### S3 — fix in PR or track

**F4 · S3 · `deal-watch.service.ts:322-325 / 382 / 471`** — a non-429 GGG error (500/503/403)
from `priceSearch` or `createSearch` **throws** `TradeApiError` (client throws on any `!ok`
except 429); it's caught+warned in `runQueue` but no state is written, so `nextRefreshAt`
keeps its already-past value → `scanDueRefreshes` re-enqueues every 30 s → a retry storm on a
GGG outage, and `derive-failed` (set only on `created.id === null`) never fires.
_Fix:_ catch non-429 `TradeApiError` in `processJob`, set `derive-failed`, push `nextRefreshAt`
out (queue backoff), mirroring the 429 branch.

**F5 · S3 (borderline S4) · `deal-watch.service.ts:460-469`** — the flat-market short-circuit
(`capExalted === state.capExalted`) updates `capBaseline`/status but never resets
`derivedCreatedAt` nor re-POSTs, so `derivedIdAgeMs` stays `> DEAL_MAX_ID_AGE_MS` forever →
`needsRederive` is perpetually true but the id is never refreshed. The "bounded id lifetime
even in a flat market" invariant is not delivered (partly masked by content-addressed ids and
the reactive `derived-expired` recovery; P0.2b unprobed).
_Fix:_ reset `derivedCreatedAt` on the same-cap short-circuit.

**F6 · S3 · `deal-watch.service.ts:235-259`** — `disable()` runs in the request handler
outside the serialized queue and awaits `resolveRestoreTarget` (GGG). If an in-flight re-derive
swaps the id A→B during that await, `swapDealSearch(A)` throws `NotFoundException`; the catch
(not a `ConflictException`) falls to `updateDealState(row.id=A)` → `requireWatcher(A)` throws
**again, uncaught** → 500, deal mode left enabled on B.
_Fix:_ guard the catch against a vanished row (re-resolve by `watchId`), or route disable
through the D-dw-8 queue with post-await revalidation.

**F7 · S3 · `deal-watch.service.ts:376`** — the `derived-expired` write uses the pre-await
`state` snapshot (captured at `:356`), not a re-read. A synchronous `editConfig` threshold
change landing during the `resolveQuery` await is clobbered by the stale write; the later
debounced re-derive reads the reverted row → operator edit permanently lost. Narrow (ws-down +
resolve-404 + concurrent edit).
_Fix:_ re-read current state before the `derived-expired` write (as the main path does at
`:388-391`), or only set `forceRederive` and let the revalidated branch persist the status.

**F8 · S3 · `search-manager.ts:777-788` + `import.service.ts:90`** — `watchId` survives export
(the spread nulls only runtime fields) and import **reuses** it; the D-dw-10 subset deliberately
omits `watchId`. Export → re-derive (id churns) → re-import the stale file (or import the same
file twice) yields two rows with the same `watchId`: `rowByWatchId` returns only one, `snapshots`
is shared (wrong cutoff/rates → wrong suppression/discount), and `deal_baseline_history`
merges/prunes across both.
_Fix:_ strip `watchId` on export and mint a fresh `randomUUID()` in `rebuildDealWatch`.

**F9 · S3 (borderline S4) · `deal-baseline.service.ts:97`** — gate is
`survivors.length === 0 || survivors.length < DEAL_MIN_SAMPLE`; D-dw-2 step 5 specifies only
`survivors == 0 → insufficient`, else `median(cheapest min(K, survivors))`. The extra
`< MIN_SAMPLE` gate is stricter than the operator-confirmed statistic and is **not** in the
as-built deviations — a liquid item that loses survivors to the outlier drop gets no baseline
(conservative false-negative direction).
_Fix:_ gate on `=== 0` only, or record the stricter threshold as a signed-off deviation.

**F10 · S3 (borderline S4) · `deal-baseline.service.ts:110` vs `packages/shared/src/deal-watch.ts:54`**
— `rawLowestExalted = survivors[0]` is the cheapest listing _after_ the outlier drop, but the
field doc + D-dw-2 say "raw cheapest usable listing" (`usable[0]`). When a decoy is dropped the
field hides the very decoy it exists to reveal; the wrong value is persisted verbatim to
`deal_baseline_history`. Display-only (never used in math).
_Fix:_ use `usable[0]`, or correct the type comment.

**F12 · S3 · `currency-rate.service.ts:24` / `deal-baseline.service.ts:121` / `deal-hit.decorator.ts:77`**
— the exalted-conversion rule (exalted short-circuit, ApiId lookup, unknown→null, `amount×rate`)
is implemented three times, and `CurrencyRateService` (+ `exaltedToUnit`/`unitToExalted`) has
**zero** production callers despite D-dw-3 naming it the abstraction. Bartosz's radar: 3+
instances → extract. The two sync copies exist for the no-await hot path; a shared
`toExaltedFromMap(amount, code, map)` on `CurrencyRateService` unifies them.
_Fix:_ extract one shared sync helper; either wire `CurrencyRateService` in or remove it.

**F13 · S3 · `deal-watch.service.ts:367-380` + `:471`** — only `computeBaseline` checks
`minHeadroom`. The expiry-probe `resolveQuery` and the re-derive `createSearch` (a 2nd
search-POST after the baseline pair) spend GGG budget with no headroom reserve; the plan
requires the gate on "every GGG-spending path." Governor + guard still bound them and the
amounts are tiny — a priority-reserve gap, not runaway spend.
_Fix:_ check `minHeadroom` before the probe and before the re-derive POST.

**F14 · S3 · `deal-watch.service.ts:245-287`** — `disable()`/`resolveRestoreTarget` fire
`resolveQuery`/`createSearch` with no `isDetectionGloballyPaused()` check, violating "operator
pause = zero GGG traffic." (The guard-tripped half is already safe — enforced at the HTTP layer
→ `GuardTrippedError` → `restore-failed`; only the global-pause case leaks.)
_Fix:_ skip/defer the GGG restore while globally paused (surface a restore-deferred state).

**F17a–h · S3 · missing tests for load-bearing paths** (verifier: each would not fail on
regression today):

- **F17a** — real `swapDealSearch` guards (same-id no-op, collision→409) + list-order
  preservation; the service test mocks `swapDealSearch`, and `search-manager.test.ts` never
  calls it.
- **F17b** — id-edit 409 rejection while deal mode on (`editSearch` throws for a `dealWatch` row).
- **F17c** — `recordHits`→`HitDecoratorRegistry` integration: `deal` column in the same insert
  tx, `suppressAlert`→persisted-but-no-event. Only the decorator-in-isolation is tested.
- **F17e** — `processJob` budget-low / rate-limited handling and the post-await id-changed bail.
- **F17f** — queue coalescing (last-trigger-wins) + the same-cap no-op short-circuit.
- **F17g** — guard-tripped / globally-paused queue no-op (the hard-rule-#4 "zero GGG while
  paused" invariant).
- **F17h** — even-length `median` branch (all current tests yield odd-length medians though
  production `usable` is routinely even). _Borderline S4._
  _Fix:_ add the missing assertions; these are the intent-and-failure-path gaps behind the S2/S3
  logic findings above.

### S4 — batch, non-blocking

F11 (bare `deal_watch` cast, no zod-at-read — no reachable malformed-JSON path in Phase 1) ·
F15 (queue-tick body lacks try/catch — no concrete throw path today; defensive) ·
F16 (correlation id not threaded across a deal op's legs — observability only) ·
F17d (redundant export-side runtime-nulling untested; the functional discard + v4 round-trip
IS covered) · F19 (`QUEUE_TICK_MS` not in env schema) · F21 (decorations built outside the
insert-tx try; current decorator is throw-safe) · F22 (`manualRefresh` doesn't skip
archived/disabled) · F23 (dead `'capped'` status) · F24 (index 2nd column unused by the actual
queries) · F25 (`DealJobKind` vestigial) · F26 (budget-low ~1 h backoff too long) · F27 (cap
counts archived/disabled rows) · F28 (combined `PATCH {input, dealWatch}` drops `dealWatch`;
UI locks the id input so unreachable in practice) · F29 (plan config table omits
`DEAL_BASELINE_HISTORY_MAX`).

### Refuted (not findings)

- **F18** — `dealWatchConfigSchema` without `.strict()` is consistent with every other
  controller schema (`.strict()` is reserved for file-upload/import); not a gap.
- **F20** — the `BaselineComputation` if-chain is already compile-exhaustive: after the
  non-`ok` returns, `computation.baseline` is accessed, so a new member lacking `baseline` is a
  TS error. A formal `assertNever` is belt-and-suspenders only.
- **F30** — CHANGELOG has no Phase-1 entry: this is server-core with no user-facing surface,
  the v4 export bump is backward-compatible, and prior version bumps were never logged as such;
  the entry belongs with the Phase 2 UI.

## Verified-safe (aggregated CLEAN)

- **D-dw-6 (critical / no-guessing):** `withPriceCap` POSTs `price = {max: capExalted}` with
  **no `option`** (the value-converting cap); no currency-literal cap anywhere; traced to
  api-notes 2026-07-05. The `disabled:false` group flag it adds is an _evidenced_ query shape.
- **Every new GGG behavioural claim is evidenced or `TODO(verify)`:** content-addressed ids,
  `sort {price:'asc'}`, `status {online}` (carries `TODO(verify)` P0.9), resolve-404 = dead id
  (P0.8), ApiId == GGG code, DivinePrice — all in api-notes "Self-created searches" 2026-07-05.
- **Hard rule #4:** all GGG traffic (baseline `priceSearch`, derive/restore `createSearch`,
  expiry `resolveQuery`) flows through `TradeApiClient`→governor; `createSearch` is governed and
  returns `rateLimited` on 429. poe2scout is the off-budget market-data module. No stray fetch
  to pathofexile.com.
- **Hard rule #3 (secrets):** no cookies/UA logged or returned; failures reduced to
  `DealWatchStatusCode`, raw errors only `logger.warn`; CSV `deal_discount_percent` passes the
  formula-injection guard (`escapeCell` apostrophe-prefixes negative discounts).
- **Hard rule #5:** `TravelService` gates `deal` exactly like `hit` on the search's own opt-in
  flags; `deal-updated` never triggers actions.
- **D-dw-2 statistic:** usable = priced ∧ amount>0 ∧ known-currency; low-outlier drop vs sample
  median; `median(cheapestK)` correct for odd/even; a high mirror-priced outlier can't enter
  cheapest-K so the baseline isn't corrupted; `listingsSeen`/`usableCount` counted.
- **Cutoff/cap math:** both modes; `unit` enum via live `divinePriceExalted` snapshot; cap floor
  `max(1, round(cutoff×(1+margin)))`; threshold ≥100% / > baseline → cutoff ≤0 →
  `insufficient-data` (never a bad cap).
- **Drift** vs `capBaseline` with `referenceAmount<=0 → Infinity` (no div-by-zero); slow
  accumulation re-derives correctly (`capBaseline` only advances on an actual re-derive).
  `nextRefreshAt` jitter cannot go negative/past for `jitterRatio ∈ [0,1]`.
- **Queue:** coalescing, settler preservation through coalescing and through thrown jobs
  (`finally`), and post-await revalidation on the **main** path (row exists, id unchanged, deal
  mode on) are sound.
- **Decorator:** pre-derive → ordinary hit; baseline missing → `deal` with null discounts (never
  a bare hit from the first derive on); unpriceable never suppressed; `suppressAlert` honored for
  **both** publish and travel; `deal`/`deal-updated` twins; `hitColumns.deal` lands in the same
  insert transaction.
- **Seam:** `swapWatcherRow`/`swapDealSearch` keep both guards (same-id no-op success;
  collision→409→`derive-conflict`), in-place Map reorder preserves list order + hit counters,
  drip-only restart (never immediate ws start), the `editSearch` refactor preserves behaviour,
  id-edit rejected 409 while deal mode on.
- **History:** keyed on `watchId`; prune keeps newest `MAX` per watch (correct `OFFSET`/NULL
  handling); best-effort writes; `clearForWatch` on disable.
- **Migrations:** 0011 additive `ALTER … ADD` + 0012 `CREATE TABLE`/`CREATE INDEX` are
  SQLite-safe (no table rewrite); `_journal.json` (idx 11/12) consistent; `schema.ts` matches.
- **market-data:** ApiId rates exclude non-positive (`CurrentPrice > 0`), `toExalted` unknown→null,
  `divinePriceExalted` absent/non-positive→null, 15-min shared singleton cache, `minHeadroom`
  extraction is behaviour-preserving for price-check.
- **Export/import v4:** runtime fields nulled → `pending-derive`; import `.strict()`, v3 imports,
  v>4 → 400.
- **Types/reducer:** `deal`/`deal-updated` in `DomainEvent`; web reducer exhaustive in both
  branches; live-hits fold merges deal fields; `Hit.deal`/`ManagedSearch.dealWatch` (required-null)
  wired through schema/`rowToManagedSearch`/hydrate; no client/server type drift.

## SCOPE (what the review could not reach)

- No agent executed the tests or ran the migrations at runtime; type-drift/exhaustiveness rest on
  the green build gate, not a run.
- GGG live behaviour was **not** independently re-verified (hard rule #8) — code claims were
  checked against `api-notes.md` as the authoritative log, not against live GGG.
- Web Phase 2 (DealWatchModal, i18n, deal rendering, notification variant) is out of phase and
  was not assessed; `review-browser` was not run (no runnable new flow).
- Nest `onApplicationBootstrap` ordering (SearchModule before DealWatchModule) is assumed from
  the import graph, not runtime-verified — relevant to the **destructive empty-list branch** of
  `reconcileOrphanHistory` (`DELETE FROM deal_baseline_history` when `dealModeRows()` is empty).
- Single-flight-queue concurrency/races were reasoned about, not exercised under load.

## Accepted / deferred

- None deferred by the reviewer. The 6 "Phase 1 as-built deviations" in plan 41 (pre-derive rows
  decorate as ordinary hits; `unsupported-item` gate deferred to Phase 2; refresh-time
  insufficient-data keeps the old cap; synchronous enable; cap floor `max(1,round)`) are
  signed-off and were **not** re-reported.

## Fix pass (2026-07-05, same session — all findings dispositioned)

| ID   | Outcome      | Note                                                                                                                                                                                                                  |
| ---- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1   | **fixed**    | queue decline settles all awaiters (`settleAllPending`); enable/refresh return persisted state; pause/trip declines are pre-checked in `manualRefresh`                                                                |
| F3   | **fixed**    | boot parks over-cap watches as `capped` (only enabled+non-archived consume slots); `capped` rows skipped by the refresh scan; recovery on next boot with a free slot                                                  |
| F2   | **fixed**    | `SearchManager.setDealRowCleanup` seam — remove()/import-replace call `forgetWatch` (maps + history)                                                                                                                  |
| F4   | **fixed**    | `processJob` catches GGG failures → `derive-failed` + `backoffRefreshAt()` (interval × 0.25, jittered)                                                                                                                |
| F5   | **fixed**    | same-cap short-circuit resets `derivedCreatedAt` — the age invariant is now "cap re-validated"; a real id refresh happens on cap change or expiry-probe flag (documented in code)                                     |
| F6   | **fixed**    | disable runs through the serialized queue with post-await revalidation; vanished/re-pointed rows tolerated; result id handed back via `disableResults`                                                                |
| F7   | **fixed**    | expiry-probe status write re-reads live state post-await                                                                                                                                                              |
| F8   | **fixed**    | export ships `ExportedDealWatch` (config minus `watchId`); import re-mints `randomUUID()`; double-import test                                                                                                         |
| F9   | **fixed**    | survivors gate relaxed to `=== 0` per D-dw-2; boundary test added                                                                                                                                                     |
| F10  | **fixed**    | `rawLowestExalted = usable[0]` (decoys included, display-only); test updated                                                                                                                                          |
| F12  | **fixed**    | ONE pure impl in `market-data/currency-rates.ts` (convert/unitTo/exaltedTo); caller-less `CurrencyRateService` FOLDED AWAY (deleted) — cleaner than inventing callers; baseline/decorator/cutoff all route through it |
| F13  | **fixed**    | expiry probe + re-derive POST behind `minHeadroom ≥ DEAL_MIN_HEADROOM`; budget decline keeps old cap + short backoff, status untouched                                                                                |
| F14  | **fixed**    | disable while paused/tripped parks as new status `restore-pending`; queue completes the restore on resume (zero GGG while paused)                                                                                     |
| F11  | **fixed**    | `parseDealWatchState` zod-at-read (`deal-watch-state.schema.ts`, status enum drift-guarded); malformed JSON → ordinary search + warn                                                                                  |
| F15  | **fixed**    | queue beat wrapped in try/catch                                                                                                                                                                                       |
| F16  | **fixed**    | one correlationId per job threads probe/baseline/derive/restore legs                                                                                                                                                  |
| F17a | **fixed**    | real `swapDealSearch` test: same-id no-op, collision 409, list-slot + hits re-point                                                                                                                                   |
| F17b | **fixed**    | id-edit 409 while deal-on + label-only-still-allowed test                                                                                                                                                             |
| F17c | **fixed**    | recordHits→registry integration test: deal column in the same tx, suppressAlert = persisted-but-silent, never a bare `hit`                                                                                            |
| F17d | **fixed**    | export-subset test asserts EXACTLY the 6 config keys (subset shape made runtime-nulling structurally impossible)                                                                                                      |
| F17e | **fixed**    | budget-low enable + post-await id-changed bail tests                                                                                                                                                                  |
| F17f | **fixed**    | same-cap no-op (no POST, no swap) + F5 age-reset test                                                                                                                                                                 |
| F17g | **fixed**    | paused + guard-tripped enable settle with zero GGG tests                                                                                                                                                              |
| F17h | **fixed**    | even-length median test (sample + cheapest-K)                                                                                                                                                                         |
| F19  | **fixed**    | `DEAL_QUEUE_TICK_MS` in the env schema (min 5 s, default 30 s)                                                                                                                                                        |
| F21  | **fixed**    | `HitDecoratorRegistry.decorate` try/catch — a throwing decorator logs and falls through to an ordinary hit                                                                                                            |
| F22  | **fixed**    | `manualRefresh` declines archived/disabled/paused/guard-tripped with explicit codes → controller 409 `deal-refresh-<code>`                                                                                            |
| F23  | **fixed**    | `capped` status wired by the F3 boot cap                                                                                                                                                                              |
| F25  | **fixed**    | vestigial `DealJobKind` removed (jobs carry `forceRederive`/`disable` flags)                                                                                                                                          |
| F26  | **fixed**    | budget-low/429 retry uses `backoffRefreshAt()` (interval × 0.25) instead of a full interval                                                                                                                           |
| F27  | **fixed**    | cap counts only enabled, non-archived deal rows (enable + boot)                                                                                                                                                       |
| F28  | **fixed**    | combined `PATCH {input, dealWatch}` applies editSearch first, then the deal config against the NEW id; controller test added                                                                                          |
| F29  | **fixed**    | plan config table gained `DEAL_BASELINE_HISTORY_MAX` + `DEAL_QUEUE_TICK_MS` rows                                                                                                                                      |
| F24  | **deferred** | keeping the `(watch_id, computed_at)` composite index — it is the intended access path for newest-first per-watch reads as the query set grows; harmless today                                                        |

**Post-fix note:** a new `DealWatchStatusCode` value `restore-pending` was added (F14) —
Phase 2 i18n must cover 12 codes, not 11. `pnpm verify` green after the fix pass.

## Verdict

**UNBLOCKED after the same-session fix pass** (see table above): both S2s fixed, all S3s fixed, S4s batched-fixed except F24 (deferred with reason). Original verdict below for the record.

**BLOCKED.** No S1. **2 confirmed S2, un-deferred:**

- **F1** — `enable`/`manualRefresh` hang the HTTP request while detection is globally paused or
  the guard is latched-tripped (`deal-watch.service.ts:303-318`).
- **F3** — `DEAL_MAX_WATCHES` is bypassed by import + boot re-queue → uncapped concurrent deal
  sockets against an unprobed GGG tolerance (`import.service.ts` + `search-manager.ts:812-877`).

Clear these two (fix, or defer with owner + ticket — noting S2 is deferrable but S1 is not), then
re-run the affected agents (correctness, reliability, security) against the new diff and update
**this** record. The 18 S3s (10 core-logic + 7 tests + F2) should be fixed-in-PR or tracked; the
14 S4s batch.
