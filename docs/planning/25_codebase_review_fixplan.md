---
type: review
status: proposed
tags: [poe2, sniper, review, fix-plan]
created: 2026-06-24
---

> Output of the `fullcodebase-review` multi-agent workflow (8 lenses → adversarial per-finding verification → synthesis): 56 raw findings, **52 confirmed / 4 refuted**, merged to **32 distinct issues**. Reflects D-19 (Buy/Travel decoupling). **PLAN ONLY — no fixes applied yet.**

# Fix Plan — poe-trade-sniper (post Phase 1+2 review)

## Scope & method

- **Scope:** whole codebase, after Phase 1 (macOS permission framework) and Phase 2 (per-search Buy automation) shipped. Server (NestJS), web (React/Vite), desktop (Electron), shared, docs.
- **Method:** 8 review lenses (security, consistency-with-intent, correctness, design/SOLID+duplication, frontend/a11y/i18n, runtime reliability, performance/DB, testing) → adversarial verification; false-positives already dropped; near-duplicates merged below.
- **Counts (after merge):** S1 = 0, S2 = 3, S3 = 13, S4 = 16. **32 distinct issues.**

Note: four separate findings collapsed to one root cause each — the PermissionsCard/network-view coupling (4 reports → **WEB-1**), the buy-status dead/unrendered state (2 reports → **WEB-2**), the nut.js version drift (2 reports → **DOC-2**), and the synthetic-grace env parse + config drift + magic-number (3 reports → **DESK-3**, split into a correctness fix and a config-sourcing fix that share one edit).

---

## S1 — none

No critical (data-loss / RCE / credential-leak / total-outage) findings. The PoE-session-as-credential hard rule is intact across all findings (no logging/returning/showing of the cookie; the only security items are local-only hardening on the at-rest key and the CDP window).

---

## S2 — correctness / reliability on the buy + governor core path (3)

### SEC/REL-1 — `Retry-After` NaN silently drops the 429 lockout (and wedges policy spacing)

- **Area:** server — rate-limit governor (load-bearing, hard rule #4)
- **File:** `apps/server/src/ratelimit/rate-limit-governor.ts:67`
- **Issue:** `Number(headers.get('retry-after') ?? 60)` yields `NaN` for the RFC-7231 HTTP-date form (Cloudflare fronts pathofexile.com — `api-notes.md:60`) or any malformed value. `NaN` propagates: `pauseAll(NaN)` → `globalPauseUntilMs = Math.max(x, NaN) = NaN` → status getter `NaN > Date.now()` is false → the 429 pause is **silently lost**. Worse: in `acquire()`, `Math.max(now, NaN, …)` writes `NaN` into `policyNextSlotMs`, so that policy's request spacing stays broken until process restart.
- **Fix:** parse defensively and fail closed:
  `const raw = Number(headers.get('retry-after')); const retryAfterSeconds = Number.isFinite(raw) && raw >= 0 ? raw : 60;`
  Add a governor test feeding a non-numeric/date-form `Retry-After` and asserting the pause still engages and policy slots stay finite.
- **Effort:** S

### REL-2 — `osascript` focus calls have no timeout/abort → hung call wedges auto-buy forever

- **Area:** desktop adapter, consumed by server buy orchestrator
- **File:** `apps/desktop/src/platform/capture-source.electron.ts:46-65` (`focusGameWindow`, `isGameWindowFocused`); awaited at `apps/server/src/buy-automation/buy-automation.service.ts:134,136`
- **Issue:** both call `execFileAsync('osascript', …)` with no `{ timeout }` and no `signal`; the orchestrator's `controller.signal` is never threaded in. A hung `osascript` (pending Automation/Accessibility prompt, unresponsive System Events) never resolves → `run()` never reaches `finally` → `running` stays `true` → every later buy is dropped by the single-flight guard for the process lifetime, plus a leaked child. Fails safe (no unintended buy) but permanently disables the feature silently.
- **Fix:** add `{ timeout: BUY_FOCUS_TIMEOUT_MS, killSignal: 'SIGKILL' }` (new tunable, **not** the 250ms `BUY_FOCUS_VERIFY_MS` — too tight) and/or `Promise.race` the focus awaits against a deadline in the orchestrator so a hung call rejects as focus-failed. See **REL-3** — prefer one shared wall-clock deadline over the whole `run()` pipeline.
- **Effort:** S

### REL-3 — capture loop awaits `getSources()` with no per-frame deadline → same wedge

- **Area:** desktop adapter, consumed by server buy orchestrator
- **File:** `apps/desktop/src/platform/capture-source.electron.ts:26-42` (`capture`); awaited at `apps/server/src/buy-automation/buy-automation.service.ts:191`
- **Issue:** `capture()` awaits `desktopCapturer.getSources()` with no signal/timeout. The combined `BUY_CAPTURE_TIMEOUT_MS`/user-input signal only gates the `delay()` between iterations, not the in-flight `capture()`. A `getSources()` stall (display reconfig / GPU) hangs past the deadline → same `running=true` wedge as REL-2.
- **Fix:** **Root fix that subsumes REL-2 + REL-3:** put a single hard wall-clock deadline on the whole `run()` pipeline so any hung port call (focus, capture, locate, move) always falls through to the `finally` that resets `running`. Per-call `Promise.race` is acceptable but leaves a dangling promise; the pipeline deadline is the robust option. Add a test with a never-resolving mock `capture()`/`focusGameWindow()` asserting `run()` rejects and `running` resets.
- **Effort:** M
- **Shared root cause:** REL-2 + REL-3 are the same defect class (unbounded `await` on a desktop port call inside the single-flight buy run). Fix together with one deadline wrapper.

---

## S3 — correctness, design, docs/decision drift, a11y, perf, tests (13)

### WEB-1 — PermissionsCard hidden behind the dev `networkViewEnabled` flag (merged ×4)

- **Area:** web
- **File:** `apps/web/src/pages/SettingsPage.tsx:388`
- **Issue:** render gate is `{isMacDesktop && networkViewEnabled && status && …}`, contradicting both the in-file comment (`SettingsPage.tsx:154-157`, "Not coupled to the network-view flag") and the recorded as-built decision (`docs/planning/24_buy_automation_plan.md:340`). An operator who turns the dev Network view off loses the only UI to grant Screen Recording + Accessibility, making Buy un-grantable from the app with no visible reason.
- **Fix:** drop `networkViewEnabled` from the condition → `{isMacDesktop && status && (<PermissionsCard permissions={status.permissions} />)}`. (Verified line 388; `permissions` is a required field on `StatusResponse`, the `status &&` guard stays.)
- **Effort:** S
- **Merge note:** reported 4× across consistency / correctness / design / a11y lenses — single one-line fix.

### WEB-2 — Buy progress reduced into `buyStateByListingId` but never rendered (merged ×2)

- **Area:** web
- **File:** `apps/web/src/hooks/EventStreamProvider.tsx:118-126` (producer); `apps/web/src/shell/HitsPanel.tsx:78`, `apps/web/src/pages/HitCard.tsx`
- **Issue:** every `buy` SSE event is reduced into `buyStateByListingId`, but no component reads it. HitCard renders only travel phases; the sole buy feedback is an OS notification gated behind `isNotifyEnabled()` and only firing for `moved`/`failed`/`aborted`. Intermediate phases (`window-found`, `item-located`, `started`) reach no UI — the plan's promised row status (§4.4 / dataflow line 166) never shipped. (One report tagged S4 as "dead state", one S3 as "feedback gap" — the in-app row status is a real design-completeness miss → S3.)
- **Fix:** thread `buyStateByListingId[listing.listingId]` into HitCard, mirroring the travel-phase block (tone classes + i18n). **Add new `hitCard.buy*` i18n keys in EN and PL** (only travel keys exist today). Keep the reducer's `case 'buy'` (`assertNever` exhaustiveness guard, decision #7) — only the storage was unconsumed.
- **Effort:** M

### CORR-1 — `update()` blocks any patch on a Buy search once macOS control is revoked

- **Area:** server
- **File:** `apps/server/src/search/search-manager.ts:228-229`
- **Issue:** `update()` resolves `autoBuy = options.autoBuy ?? watcher.row.autoBuy` (the **persisted** value) then unconditionally `assertAutoBuyAllowed(autoBuy)`, which calls the live `gate.canControl()`. Once control is revoked, any unrelated PATCH (rename, `enabled:false` to pause, `purchaseMode`) throws `BadRequestException('grant Screen Recording…')` — the operator can't even pause the search. Contradicts decision #2=B ("persisted autoBuy intent preserved and restored on re-grant").
- **Fix:** only gate when Buy is being turned **on** in this request: `if (options.autoBuy === true) this.assertAutoBuyAllowed(true);`. Keep the runtime gate in `BuyAutomationService` (`:101`) as the real enforcement — a stale persisted `true` never fires a buy. Add a test that revokes mid-life (DENY_GATE) then patches an unrelated field and asserts success.
- **Effort:** S

### A11Y-1 — no ARIA live region for streaming hits / no `role` on banners

- **Area:** web
- **File:** `apps/web/src/shell/HitsPanel.tsx:72`; `GuardBanner.tsx:21`, `SessionBanner.tsx:9`
- **Issue:** new hits stream into a plain scrolling div and banners render as bare `<div>`s; app-wide grep for `aria-live`/`role="status"`/`role="alert"` returns nothing. The load-bearing part is the GuardBanner halt-alarm getting no announcement.
- **Fix:** `aria-live="polite"` + `aria-atomic="false"` on the hits-feed container; `role="alert"` on GuardBanner; `role="status"` on SessionBanner. Keep announcements terse. (Note: this is a generic a11y baseline improvement — no project a11y checklist exists; the `role="alert"` on the halt banner is the worthwhile core.)
- **Effort:** M

### PERF-1 — `hits` table has no secondary indexes

- **Area:** server / DB
- **File:** `apps/server/src/db/schema.ts:23-36` + `apps/server/db/migrations/*.sql`
- **Issue:** only the `id` PK exists; `listHits` filters/sorts on `search_id`, `detected_at`, `item_name` and `hydrateHitStats` aggregates per `search_id` — all full scans against a table bounded at `HITS_MAX_ROWS` (10k default).
- **Fix:** forward-only migration `0005_hits_indexes.sql`: `CREATE INDEX hits_search_id_detected_at ON hits(search_id, detected_at)` (covers per-search filter, the boot aggregate, and the time-range path). Mirror with `.index()` in `schema.ts`, regen drizzle meta. Skip an `item_name` index — the name search is leading-wildcard `LIKE` (non-sargable); an index would only help `ORDER BY item_name`, not the substring filter.
- **Effort:** S
- **Root cause shared with PERF-4, PERF-5, PERF-6** (all read the unindexed `hits` table) — do this first.

### PERF-2 — capture `getSources()` + full-frame `toBitmap()` per iteration on the Electron main thread

- **Area:** desktop
- **File:** `apps/desktop/src/platform/capture-source.electron.ts:26-42`
- **Issue:** every `capture()` does an uncached `getSources({thumbnailSize: display.size})` then a synchronous `toBitmap()` + full-frame copy, on the same event loop that runs the Nest server / SSE / detection. The buy loop calls it ~50×/run + 2× in locate. Plan §4.4 step 4 required source caching ("re-enumerate only on a detect miss") — not implemented. (`getSources` yields the JS thread, so the true blocker is the `toBitmap` copy + scan in tens-of-ms chunks; responsiveness/design-margin risk, transient and bounded → S3.)
- **Fix:** cache the resolved screen source and re-enumerate only on detect miss (plan's intent); and/or capture a downscaled thumbnail (the violet cluster is large) scaling coords back. Higher-value lever: move `toBitmap`+scan to a worker/`utilityProcess`.
- **Effort:** M
- **Shared with PERF-3 + PERF-7** (the buy capture hot loop on the main thread) — address as one pass.

### PERF-3 — violet scan runs synchronously on the main event loop

- **Area:** desktop
- **File:** `apps/desktop/src/platform/trade-vision.adapter.ts:21-43`
- **Issue:** `violetBounds` scans the full (logical-resolution) frame in a sync nested loop on the Electron main thread; `Promise.resolve(violetBounds(...))` does **not** offload. Plan §2.1/§4.3 specified a `worker_thread` "to keep the Nest event loop/SSE responsive"; as-built there are zero workers. Bounded (5s timeout, yields between scans, opt-in/rare) but the placement is structurally wrong.
- **Fix:** cheapest — bound the scan to the focused-window region instead of the whole desktop frame, or yield between row bands; optionally move capture+scan to a worker/`utilityProcess`. Buy thresholds stay legitimately `TODO(verify)`.
- **Effort:** M
- **Merge note:** PERF-2 + PERF-3 (+ PERF-7 dead allocation) are one hot loop. Also tied to **DOC-1** — the OpenCV→raw-pixel pivot must be recorded as a superseding decision; record that the synchronous main-process scan is accepted (or fix placement) in the same edit.

### PERF-4 — per-row hit INSERTs not batched

- **Area:** server / DB
- **File:** `apps/server/src/search/search-manager.ts:528-552`
- **Issue:** `recordHits` loops `insert(hits).values(...).run()` per listing — up to 20 separate implicit (fsync-bearing, `synchronous=FULL`) commits per burst; the bus-publish + `hitCount`/`lastHitAt`/prune bookkeeping also runs per-iteration, so a mid-loop throw leaves partial DB state with events already published.
- **Fix:** wrap the loop in one `this.database.transaction(() => { … })` (better-sqlite3 is synchronous) — one commit/fsync per burst, atomic bookkeeping.
- **Effort:** S

### DOC-1 — OpenCV-wasm → raw-pixel vision pivot unrecorded

- **Area:** docs/decisions (shared)
- **File:** `apps/desktop/src/platform/trade-vision.adapter.ts:1-69`; `docs/planning/40_decisions.md:34` (D-18); `docs/planning/30_open_questions.md:25` (O-10)
- **Issue:** the shipped adapter is a dependency-free violet-threshold detector (no OpenCV, no worker, no `trade-vision.worker.ts`), silently contradicting D-18, Plan §2.1/§4.3, and the still-"Open" O-10. The adapter's own `TODO` at line 11 cross-refs O-10, whose strategy the code abandoned. Violates the workflow hard rule "every important decision MUST be recorded".
- **Fix:** record the pivot as a superseding decision in `40_decisions.md` (rationale: spike proved violet-frame threshold sufficient + dependency-free), amend D-18's adapter list and Plan §2.1/§4.3 to drop OpenCV/worker_thread, close O-10, and note that the synchronous `SAMPLE_STRIDE=4` main-process scan is accepted in place of the worker (or reference PERF-3 if fixing placement).
- **Effort:** S

### DOC-3 — Phase-2 decisions / as-built not recorded

- **Area:** docs (shared)
- **File:** `docs/planning/40_decisions.md:34`; `docs/planning/24_buy_automation_plan.md` §7
- **Issue:** all 7 Phase-2 commits (9a335d4…98863cd) are shipped, but D-18's Commit column lists only Phase-1 commits and §7 is titled "Phase-1 as-built deviations" only — breaking the append-only "commit id once implemented" contract. The vision pivot, nut.js version, and dropped `buyAutomation` status field are undocumented.
- **Fix:** append the Phase-2 commit IDs to D-18 (or a follow-on decision) and add a "Phase-2 as-built deviations" section to §7 capturing the vision pivot (DOC-1), nut.js version (DOC-2), and the dropped `StatusResponse.buyAutomation` field (DOC-4).
- **Effort:** S
- **Shared root cause:** DOC-1/DOC-2/DOC-3/DOC-4/DOC-5/DOC-6 are all the same "app↔docs out of sync after Phase 2" gap — batch them into one docs commit.

### DOC-5 — CLAUDE.md "State of the build" stale

- **Area:** docs (shared)
- **File:** `CLAUDE.md` (State-of-build paragraph)
- **Issue:** still reads "Phases 1–4 shipped + preliminary Electron shell … Remaining: full Phase 5 packaging" with no mention of the shipped macOS permission framework or Buy automation; the manifest is read every session and Plan §5 explicitly slated this line for update.
- **Fix:** update the paragraph to note the macOS permission framework (Phase 1, gated/dev) and per-search Buy automation (Phase 2, Electron-only, move-only) as shipped; reference `docs/planning/24`.
- **Effort:** S

### DOC-6 — CHANGELOG missing the Phase-2 user-facing entries

- **Area:** docs (shared)
- **File:** `CHANGELOG.md` `[Unreleased]`
- **Issue:** the per-search Buy toggle (`04e0191`) and macOS permissions Settings card (`1ceb746`) are user-facing and landed with no CHANGELOG entry — violates `conventions.md:17` ("CHANGELOG line in the same commit as the feature").
- **Fix:** add an `[Unreleased]/Added` entry for the per-search Buy automation toggle (macOS desktop only, move-only, opt-in) and the macOS permissions card in Settings.
- **Effort:** S

### DOC-7 — architecture docs silent on the Phase-1 platform-ports seam + permission card

- **Area:** docs (shared)
- **File:** `docs/architecture/architecture.md`, `docs/architecture/frontend.md`
- **Issue:** neither doc mentions the `apps/server/src/platform/*` ports/adapters seam, the permission card, or capture, despite Plan §5 naming both as docs-to-touch and CLAUDE.md pointing every session at them as the source of truth. (Scope-narrowed: the canonical decision survives in D-18, so this is a stale-reference-doc gap, not lost knowledge; the Buy-toggle note is Phase-2, so only the ports seam + permission card are the present Phase-1 obligation.)
- **Fix:** add a short "Desktop platform ports" section to `architecture.md` (DesktopPlatform aggregate injected pre-`listen`, no-op default keeps the server cross-platform, native adapters only in `apps/desktop`) and a permission-card note (Option-A mirror) to `frontend.md`.
- **Effort:** M

### DUP-1 — `GAME_FOCUS_PROCESS` charset invariant duplicated (security-relevant, 3 consumers)

- **Area:** cross
- **File:** `apps/desktop/src/platform/build-desktop-platform.ts:17` vs `apps/server/src/config/env.ts:142`
- **Issue:** the osascript-injection guard `[A-Za-z0-9 ._-]` exists as a Zod `.regex()` in `env.ts` and as a manual `.replace()` strip in `build-desktop-platform.ts`, guarding two independent osascript interpolations (`capture-source.electron.ts:48`, `game-focus.service.ts:28`) — 3 consumers of one invariant, crossing the refactor threshold. Not an active vuln (every writer is validated/stripped today); harm is future drift.
- **Fix:** export the allowed-charset regex / a `sanitizeProcessName()` helper once (in `packages/shared` — pure, no Node deps) and reference it from both the Zod schema and the desktop strip. **Do not** "derive from validated AppConfig via loadConfig()" — `createDesktopPlatform()` runs before the server module exists, so no validated config is available in the Electron main at that point.
- **Effort:** S

---

## S4 — local hardening, minor correctness, duplication, perf nits, doc/test gaps (16)

### SEC-2 — AES session key passed in `security` CLI argv (one-time creation)

- **Area:** server — `apps/server/src/session/session-cipher.ts:41-54`
- **Issue:** the generated 32-byte hex key is inline in `execFileSync('security', ['add-generic-password', …, '-w', generated, '-U'])`; argv is readable via `ps -axww` during the one-time creation. This is the at-rest key (not the PoE session — never logged/shown), single-user local; safeStorage in packaged builds is the recorded mitigation (D-7/D-17/D-18).
- **Fix:** the finder's primary "feed `-w` over stdin" is wrong (`add-generic-password` doesn't read it from stdin). Add an inline comment that the dev `security` path briefly exposes the key in argv, and rely on the planned Electron `safeStorage` cutover for packaged builds.
- **Effort:** M

### SEC-3 — CDP debug port exposes the cookie jar during login capture (parked defence-in-depth)

- **Area:** server — `apps/server/src/session/login-capture.service.ts:59-74`
- **Issue:** spawns real Chrome with `--remote-debugging-port` and no `--remote-debugging-address`; the unauthenticated CDP endpoint exposes the cookie jar (incl. POESESSID) to any local process for the ~5-min login window. Already an accepted/parked decision (self-review 2026-06-12, D-17); a local-RCE attacker can read the same cookie from the DB anyway.
- **Fix:** defence-in-depth — pass `--remote-debugging-address=127.0.0.1` explicitly, keep the window tight (already kills Chrome on success), or switch to `--remote-debugging-pipe` to drop the TCP surface entirely. Not blocking.
- **Effort:** M

### SEC-4 — `will-navigate` uses a prefix check, not an origin compare

- **Area:** desktop — `apps/desktop/src/main.ts:104-106`
- **Issue:** `if (!targetUrl.startsWith(url))` (`url = http://localhost:${port}`, no slash) is a string-prefix check. The cited `localhost:3580.evil.com` PoC is invalid (port can't contain dots); the only real bypass is the userinfo trick `http://localhost:3580@evil.com/x`, and it's unreachable (trusted loopback renderer, no XSS sink, external links route via `setWindowOpenHandler`). Hardening nit.
- **Fix:** `if (new URL(targetUrl).origin !== new URL(url).origin) navigationEvent.preventDefault();` — one line, strictly correct.
- **Effort:** S

### DOC-2 — nut.js version drift vs D-18 (merged ×2)

- **Area:** desktop — `apps/desktop/package.json:98`
- **Issue:** D-18 records `nut.js>=5` but the dep is `@nut-tree-fork/nut-js ^4.2.6` (fork's current line is 4.x; upstream went paywalled past v3/v4). The only consumer uses stable 4.x API; pure decision-log drift.
- **Fix:** amend D-18 to record that `@nut-tree-fork/nut-js ^4.x` was deliberately chosen (upstream `@nut-tree/nut-js` paywalled past v4) — do **not** chase a `>=5` that doesn't exist under that name. Roll into the DOC-3 docs commit.
- **Effort:** S

### DOC-4 — `StatusResponse.buyAutomation` field dropped vs plan §4.4

- **Area:** server — `apps/server/src/api/status.controller.ts:11`
- **Issue:** plan §4.4 specifies `StatusResponse.buyAutomation = { lastResult, supported }`; it was never added (UI derives support from `capabilities.canControl` and last result from SSE — no functional gap). Doc/contract drift.
- **Fix:** record in §7 that the field was intentionally dropped (capabilities + SSE buy state cover both needs; a polled `lastResult` would duplicate SSE-owned state). Do **not** add the field. Roll into DOC-3.
- **Effort:** S

### DESK-3 — synthetic-grace env parse is fragile + duplicates the Zod default (merged ×3)

- **Area:** desktop — `apps/desktop/src/platform/user-input-watcher.uiohook.ts:10`
- **Issue:** `Number(process.env['BUY_SYNTHETIC_INPUT_GRACE_MS'] ?? 120)`. (a) **Correctness:** empty-string env → `Number('')=0` and non-numeric → `NaN`, making `isWithinSyntheticGrace` always false → every synthetic nut.js move looks like real input and self-aborts the buy on step one (fails safe; behind operator misconfig of a non-default var). (b) **Config drift / magic number:** the literal `120` duplicates `env.ts:151`'s Zod default, contradicting "config, not constants" and the file's own "one source" comment.
- **Fix:** one edit covers both — `const parsed = Number(process.env['BUY_SYNTHETIC_INPUT_GRACE_MS']); const SYNTHETIC_GRACE_MS = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT;` where `DEFAULT` is a **shared exported constant** imported from `env.ts` (or threaded in via `createDesktopPlatform`), removing the duplicated literal. (Same env-var-with-inline-fallback pattern recurs at `build-desktop-platform.ts:17` for `GAME_FOCUS_PROCESS`.)
- **Effort:** S
- **Merge note:** 3 reports (correctness / consistency / design) → one fix.

### REL-4 — `game-focus` osascript has no timeout → zombie child on a wedge

- **Area:** server — `apps/server/src/travel/game-focus.service.ts:29-35`
- **Issue:** `execFile('osascript', …)` with no timeout; fire-and-forget (doesn't block the travel queue), so a wedged System Events just leaks one osascript child per auto-travel until parent exit. Low blast radius.
- **Fix:** add `{ timeout: 5000, killSignal: 'SIGKILL' }`. (Errors already swallowed.)
- **Effort:** S

### REL-5 — `AbortSignal.timeout` timer not cleared on early detect success

- **Area:** server — `apps/server/src/buy-automation/buy-automation.service.ts:181-185`
- **Issue:** `detectTradeWindow` builds `AbortSignal.timeout(...)` once; on early success the underlying timer runs ~5s then GCs. Node uses an unref'd timer so it can't delay shutdown; buys are serialized so it's not a growing leak. Tidy-up.
- **Fix:** explicit `AbortController` + `setTimeout` cleared in a `finally` (combined via `AbortSignal.any`). Naturally folds into the REL-3 pipeline-deadline refactor.
- **Effort:** S

### REL-6 — `before-quit` doesn't await server close

- **Area:** desktop — `apps/desktop/src/main.ts:151-153`
- **Issue:** `void runningServer?.app.close()` with no `event.preventDefault()`; Electron can exit before close resolves. Impact is small — all `onApplicationShutdown` hooks are synchronous (engines stop, sockets `terminate()`, better-sqlite3 closes sync) — but the fire-and-forget pattern is incorrect for guaranteed teardown.
- **Fix:** track a `quitting` flag, `event.preventDefault()` on first call, `await runningServer?.app.close()`, then `app.exit(0)`.
- **Effort:** S

### REL-7 — login-capture double-start orphans a poll interval

- **Area:** web — `apps/web/src/hooks/useLoginCapture.ts:24-51`
- **Issue:** `start()` assigns `pollRef.current = setInterval(...)` inside the async `.then` with no guard; the button only disables after the POST resolves, so a fast double-click creates two intervals — the second overwrites the ref, orphaning the first (polls a server-local endpoint until unmount; no GGG traffic, server refuses a second Chrome launch).
- **Fix:** at the top of `start()`, `if (pollRef.current) clearInterval(pollRef.current);` (or bail if already set).
- **Effort:** S

### PERF-5 — OFFSET pagination on the unindexed `hits` table

- **Area:** web + server — `apps/web/src/pages/HitsPage.tsx:30-94` + `apps/server/src/search/search-manager.ts:300-307`
- **Issue:** deep infinite-scroll issues `OFFSET 200/400/…`; SQLite walks+discards skipped rows, and the `name`-sort / `LIKE` paths re-sort the filtered set per page. Bounded by `HITS_MAX_ROWS` (10k) and `limit ≤ 200`; sub-ms-to-low-ms on a local SQLite file. Common newest/oldest sort is on `id` (PK B-tree, no sort step) so the cliff only hits the `name` sort.
- **Fix:** keyset/cursor pagination on `id` for newest/oldest (`WHERE id < :lastId ORDER BY id DESC LIMIT n`); accept OFFSET for `name` sort. Lower priority than PERF-1.
- **Effort:** M

### PERF-6 — boot N+1 aggregate over `hits`

- **Area:** server — `apps/server/src/search/search-manager.ts:127-143,627-640`
- **Issue:** `hydrateHitStats` runs `count(*)+max(detected_at)` once per watched search at boot — N scans for N searches. Bounded: ≤10k-row table, sub-ms each, once at boot.
- **Fix:** one `SELECT search_id, count(*), max(detected_at) FROM hits GROUP BY search_id` distributed into watchers; the PERF-1 composite index makes it index-only.
- **Effort:** S

### PERF-7 — redundant full-frame `Uint8Array` copy per capture

- **Area:** desktop — `apps/desktop/src/platform/capture-source.electron.ts:8,40-41`
- **Issue:** `new Uint8Array(primary.thumbnail.toBitmap())` forces a second full-RGBA copy (`toBitmap()` already returns a Buffer, itself a Uint8Array) ~10×/s during a buy run — GC pressure on the main process.
- **Fix:** pass `pixels: primary.thumbnail.toBitmap()` directly (`RawFrame.pixels` is `Uint8Array`, `violetBounds` does indexed reads — typechecks and is behavior-safe). Address with PERF-2.
- **Effort:** S

### PERF-8 — engine-status SSE bump triggers full `/api/searches` refetch

- **Area:** web + server — `apps/web/src/hooks/useSearches.ts:48-50` + `apps/server/src/search/search-manager.ts:571-580,686-691`
- **Issue:** every `engine-status`/`guard` event bumps `searchesVersion`, refetching the full search list (incl. the opaque `filters` JSON per row) twice per event (useSearches + useDetection); on a flaky GGG socket this is a refetch storm. Cost is wasted loopback round-trips only — `latestRequestId` already guards stale clobbering. (Note: `engineStateBySearchId` is written but never read, so the finder's "apply delta locally" fix is wrong — the badge reads `search.engine` from the refetched row.)
- **Fix:** give `/api/searches` a lightweight list shape that omits `filters` (fetch lazily on row expand), and/or debounce the version bump during socket churn.
- **Effort:** M

### SSE-1 — no backpressure/coalesce on the SSE `network` fan-out

- **Area:** server — `apps/server/src/events/events.controller.ts:17-33`
- **Issue:** every `network` event (one per GGG call) pushes straight to `observer.next` with no throttle/coalesce. Not reachable as a flood in practice — GGG cadence is rate-governed (`POLL_INTERVAL_MS` ≥6s), single loopback EventSource, single-operator tool. Missing-contract robustness nit.
- **Fix:** if addressed, an RxJS `auditTime`/`bufferTime` on the `network` channel (or gate `network` events behind dev-view server-side).
- **Effort:** M

### DUP-2 — error-message idiom duplicated 7× (crosses radar threshold)

- **Area:** server — `apps/server/src/buy-automation/buy-automation.service.ts:230-232` (local `errorMessage`) + 6 inline copies
- **Issue:** `error instanceof Error ? error.message : String(error)` recurs at `travel.service.ts:130`, `search-manager.ts:397`, `ws-engine.ts:132`, `trade-api.client.ts:175,360`, `login-capture.service.ts:85`, plus the buy module already wrapped it locally — wants to be shared.
- **Fix:** promote to `apps/server/src/util/error-message.ts`, replace the 7 sites. Batch with DUP-4.
- **Effort:** S

### DUP-3 — duplicated osascript "focus game window" (divergent predicates)

- **Area:** cross — `apps/server/src/travel/game-focus.service.ts:26` + `apps/desktop/src/platform/capture-source.electron.ts:46`
- **Issue:** two osascript focus implementations with intentionally different predicates (`name is "X" and background only is false` vs the lenient `name contains "X"` paired with a verify step). Both read the same `GAME_FOCUS_PROCESS` env (one name source). Cross-process maintenance smell.
- **Fix:** unify the AppleScript predicate so "focus the game" has one definition. Do **not** make `GameFocusService` delegate to the injected `CaptureSource` — that breaks the standalone dev server (no-op platform returns `false`) and pushes native code behind the wrong boundary. Low priority.
- **Effort:** M

### DUP-4 — abortable-delay helper duplicated (2 instances, below threshold)

- **Area:** cross — `apps/server/src/buy-automation/buy-automation.service.ts:32` + `apps/desktop/src/platform/input-controller.nut.ts:18`
- **Issue:** `delay`/`sleep` are byte-for-byte identical (same `'aborted'` sentinel). The finder's "3rd copy in the test" is false — it's only **2** instances, below Bartosz's own "1–2 = leave it" radar threshold.
- **Fix:** optional — extract `abortableDelay(ms, signal)` to `packages/shared` (pure, bundleable by desktop) if a 3rd copy appears. Otherwise leave it; note here only because DUP-2 touches the same module.
- **Effort:** S

### WEB-3 — Buy-needs-permission note is inert text, not a link to Settings

- **Area:** web — `apps/web/src/pages/SearchesPage.tsx:408`
- **Issue:** when Buy is disabled for missing control permission, `searches.buyNeedsPermission` ("grant permissions in Settings") renders as a plain `<span>`; plan §4.5 state 5 says it should link. The shell already uses `<Link to="/settings">` for this exact pattern (`SessionBanner.tsx:13`). (The "unlabeled nav icon" sub-claim is false — `IconRail` sets title + aria-label.)
- **Fix:** when `note === 'searches.buyNeedsPermission'`, render a react-router `<Link to="/settings">` instead of a span.
- **Effort:** S

### WEB-4 — `AddSearchForm.onAdd` redeclares the payload shape (type drift)

- **Area:** web — `apps/web/src/pages/SearchesPage.tsx:90-95`
- **Issue:** inline `onAdd` literal (`autoTravel` required, omits `autoBuy`/`purchaseMode`) is a second source of truth vs the exported `AddSearchPayload` (`useSearches.ts:6-13`); compiles by structural compatibility but drifts as the payload grows.
- **Fix:** import `AddSearchPayload` and type `onAdd: (payload: AddSearchPayload) => Promise<void>`.
- **Effort:** S

### WEB-5 — `/network` route reachable by URL when dev view is off

- **Area:** web — `apps/web/src/shell/AppShell.tsx:71`
- **Issue:** routes are registered unconditionally from `NAV_ENTRIES`; only the rail icon honors `devOnly`/`networkVisible`, so `/network` stays reachable via direct URL / back-forward. Cosmetic — the log is redacted (no credential exposure, hard rule #3 upheld).
- **Fix:** filter routes by the same `networkViewEnabled` predicate, or redirect `devOnly` routes to `/` when hidden.
- **Effort:** S

### TEST-1 — web has no test runner; `resolveBuyControl` + `reduceEvent` uncovered

- **Area:** web — `apps/web/package.json` (test is an `echo` stub; no vitest)
- **Issue:** the pure `resolveBuyControl` (`SearchesPage.tsx:73`, encodes decision #2=B UI gating) and the SSE `reduceEvent` (`EventStreamProvider.tsx:91`) ship with zero coverage and no harness. Plan §5 steps 2.3/2.7 + `conventions.md:32` require these tests. (Not safety-critical — the real character-control gate is server-side and tested; this is presentational.)
- **Fix:** add vitest + jsdom/happy-dom + @testing-library/react, wire `"test": "vitest run"` into `pnpm verify`. **Export `resolveBuyControl` first** (currently module-private). Test the **four** branches (web / non-mac / `!canControl` / live `checked===autoBuy`) — there is **no** `!autoTravel→requires-travel` branch (D-19 decoupled Buy from Travel; the finder's 5-state matrix is stale). Test `reduceEvent` per event type incl. the null-`listingId` no-op.
- **Effort:** M
- **Shared harness:** TEST-1 + TEST-4 both add a vitest harness to a package that has none — set them up together.

### TEST-2 — no boot-contract test for `startServer({ platformFactory })`

- **Area:** server — `apps/server/src/server.ts:46`
- **Issue:** the pre-`listen` platform registration (decision #2, plan step 1.3) has no test. The genuine uncovered slice is the Nest DI-graph resolution (token typo / missing export) that `tsc --noEmit` doesn't exercise. (The D-11 "undefined metadata" and "startup race" framings don't apply — tokens use `{provide, useValue}` and registration is synchronous before `listen`; the post-bootstrap bus pipeline is already tested at the service level.)
- **Fix:** add `platform.module.test.ts` via `Test.createTestingModule(AppModule.register(...))`: no factory → resolve `CAPTURE_SOURCE`/`INPUT_CONTROLLER` and assert they are the no-op adapters; fake factory → assert they are the fakes.
- **Effort:** M

### TEST-4 — desktop has no test harness; `requireGrant` + synthetic-grace marker uncovered

- **Area:** desktop — `apps/desktop/src/platform/require-grant.ts:10`, `synthetic-input-marker.ts`
- **Issue:** no vitest harness; two pure, native-free, load-bearing units are untested — `requireGrant` (the adapter self-gate chokepoint, decision #3) and `isWithinSyntheticGrace`/`markSyntheticMove` (the O-7 self-abort the buy MOVE depends on). Plan step 2.6 requires both. An inverted grace check would silently break every buy or ignore real user input.
- **Fix:** add vitest to `apps/desktop`, wire into `pnpm verify`. Test `requireGrant` throws naming the missing kind per non-granted state / passes when granted; test the marker with fake timers (true immediately after `markSyntheticMove()`, false after the window). Optionally unit-test the `sanitizeProcessName` regex extracted in DUP-1. (Native adapters correctly excepted.)
- **Effort:** M

### TEST-3 — buy `BUY_*` env tunables not asserted

- **Area:** server — `apps/server/src/config/env.test.ts:1`
- **Issue:** `env.test.ts` checks only `APP_ENV`/`PORT`/`DB_PATH`; the Phase-2 `BUY_CAPTURE_POLL_MS`/`_TIMEOUT_MS`/`SYNTHETIC_INPUT_GRACE_MS`/`FOCUS_VERIFY_MS` defaults and `.min()` bounds are unpinned — a default drift or removed bound would pass.
- **Fix:** assert `loadConfig({})` yields the documented BUY\_\* defaults and that `loadConfig({ BUY_CAPTURE_POLL_MS: '5' })` (below `.min(20)`) throws the readable Zod error.
- **Effort:** S

### TEST-5 — no e2e for the auto-buy refusal HTTP path

- **Area:** server — `e2e/api.spec.ts:31`
- **Issue:** the auto-buy refusal is unit-tested (`search-manager.test.ts:132`) and re-gated at the adapter boundary, but no e2e exercises schema→manager→`BadRequestException`→400. Thin defence-in-depth gap.
- **Fix:** add an e2e case — but the finder's recipe is wrong on three points: (1) auto-buy is gated by control **only** (D-19 decoupled it from auto-travel); (2) the thrown message is `grant Screen Recording + Accessibility`, no `auto-travel` substring; (3) `add()` runs `resolveQuery` (→`NoSessionError` 400) **before** the auto-buy gate, so a sessionless POST never reaches it. **PATCH a pre-seeded search with a session/DB fixture** and assert 400 matching `/Screen Recording/`.
- **Effort:** S

---

## Recommended order

1. **SEC/REL-1 (governor NaN)** — first. Load-bearing no-ban path (hard rule #4); a single malformed `Retry-After` silently drops a lockout and corrupts policy spacing. Highest correctness/safety payoff, S effort.
2. **REL-2 + REL-3 (+ REL-5)** — the buy-pipeline hang. One `run()` wall-clock deadline fixes both unbounded-await wedges and naturally absorbs the timer-clear; all in `buy-automation.service.ts` + `capture-source.electron.ts`. Restores the only failure that permanently disables Buy for the session.
3. **CORR-1 (update-blocks-on-revocation)** — correctness regression against decision #2=B; small, same `search-manager.ts` file as PERF-4/PERF-6.
4. **WEB-1 (PermissionsCard gate)** — one-line fix that re-enables the only UI path to grant permissions; unblocks the whole Buy feature for operators. Do alongside **WEB-3/WEB-4** (same `SearchesPage.tsx`) and the **WEB-2** HitCard buy-status render (same `EventStreamProvider`/`HitsPanel` area).
5. **PERF-1 (hits index)** — root cause behind PERF-5/PERF-6; the migration unblocks index-only rewrites. Then **PERF-4** (batch inserts) and **PERF-6** (GROUP BY) in the same `search-manager.ts`.
6. **PERF-2 + PERF-3 + PERF-7** — the buy capture hot loop (one `capture-source.electron.ts` + `trade-vision.adapter.ts` pass): cache source / bound the scan region / drop the redundant copy.
7. **DESK-3** — fix the fragile synthetic-grace parse (correctness, fails safe today but a misconfig breaks every buy) and remove the duplicated default in the same edit.
8. **Test harnesses (TEST-1 + TEST-4 together, then TEST-2/TEST-3/TEST-5)** — stand up vitest in web + desktop once, then pin the buy resolver, the grant chokepoint, the synthetic-grace marker, the boot contract, the env bounds, and the refusal e2e. Pins the fixes above against regression.
9. **Docs batch (DOC-1…DOC-7, DUP merges' decision notes)** — one commit syncing decisions log / plan §7 / CLAUDE.md / CHANGELOG / architecture docs. Cheap, closes the append-only-contract breaches, and records the vision pivot + nut.js + dropped status field deviations.
10. **Remaining S4 hardening/cleanup** — SEC-2/SEC-3/SEC-4 (local defence-in-depth), REL-4/REL-6/REL-7, A11Y-1, DUP-1/DUP-2/DUP-3, WEB-5, PERF-8, SSE-1. Low urgency; group by file (DUP-2 with the buy module, DUP-1 with the shared package).

Security/correctness on load-bearing paths (governor, buy hang, permission re-enablement) lead; perf, docs, and polish follow.

## Verdict

No S1, no live exploitable vulnerability or credential leak — but three S2 reliability bugs on the buy/governor core path (a malformed `Retry-After` silently disarms the no-ban governor; two unbounded `await`s permanently wedge auto-buy) plus a one-line permission-card regression must land before this is trusted unattended; the rest is well-scoped S3/S4 hardening, perf, test-harness, and doc-sync debt.
