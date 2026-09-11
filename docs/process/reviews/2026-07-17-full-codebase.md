# Full-codebase review — 2026-07-17

**Scope:** the entire working tree of `poe-trade-sniper` as it stood on 2026-07-17 —
branch `main` at `e37d002`, **plus the uncommitted D-21 `SecretKeyStore` platform port
and the PERF-1 activity-pruning fix** (26 modified + 7 untracked files at close).
~340 TS/TSX files across `apps/server` (NestJS), `apps/web` (React/Vite),
`apps/desktop` (Electron), `packages/shared`. Static review + local probes only — no
live GGG endpoints touched, no `dev:desktop`, no browser tools (`review-browser`
deliberately skipped per operator request).

**Explicitly a pre-public-release audit, not a diff review.** The project was
architected as a single-operator personal tool (D-3: "single-user tool"); that premise
is dead and `release.yml` already builds mac/win/linux on a `v*` tag. Every reviewer
was instructed to re-judge single-user assumptions against a public audience on someone
else's machine — and every verifier was instructed to check whether that instruction
had _primed inflation_.

**Reviewers (9, parallel):** security, correctness, consistency, testing, architecture,
reliability, performance, frontend, a11y. **Every** finding was then routed through
`review-verifier` in 7 adversarial refute passes before consolidation. Severities below
are the **verifier's corrected values**, not the specialists' originals — the verifiers
moved a large fraction of them.

**Working tree moved mid-review:** `LICENSE`, `THIRD-PARTY-NOTICES.md` and
`scripts/generate-third-party-notices.mjs` landed while the specialists were running
(closing O-11). They are new and were **not** reviewed by the specialist pass.

---

## Automated gates

| Gate                                    | Result                                                                                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm verify` (lint + typecheck + test) | **GREEN** — server 444 / web 176 / desktop 11, 51 server test files                                                                            |
| `gitleaks detect`                       | **CLEAN** — 273 commits, ~3.11 MB scanned, no leaks                                                                                            |
| `pnpm audit --audit-level=high`         | 17 vulns / 6 high — **all 6 suppressed** via `auditConfig.ignoreGhsas`; suppressions verified sound, **comment factually wrong** (S4, AUDIT-1) |
| `pnpm format:check`                     | **RED** — 5 files, incl. both new source files. Hard-fails the pre-push hook. Fix before commit: `pnpm format`                                 |

The 5-vs-6 GHSA discrepancy is resolved: 5 distinct GHSAs, 6 advisory rows —
`GHSA-vxpw-j846-p89q` matches **both** installed undici versions (7.27.2 via
`@electron/get`, 6.26.0 via `node-gyp`) and pnpm counts advisory × version. The list is
complete.

---

## Verdict: BLOCKED

**One confirmed S1** (`FK-1` — silent, irreversible hit-history loss on the
import-replace path) and **seven confirmed S2**, none deferred. S1 is never deferrable.

The uncommitted work under the hardest scrutiny — **D-21 `SecretKeyStore` is
fundamentally sound**: the envelope scheme is correct (random 32-byte key, AES-256-GCM,
fresh IV per encrypt, one on-disk format across shells), the port/adapter split holds,
`apps/server` still imports zero native/Electron code, and the three-reviewer consensus
that it destroys keys on transient failure was **refuted**. **PERF-1's prune query is
also correct and fast** (measured 19 ms for 50k→2k, no temp B-tree, cost tracks rows
deleted not set size) — but the prune it schedules **never runs**, which is `ACT-1`.

### Severity summary

| Severity    | Count | IDs                                                                                                                                                                                                                                                                     |
| ----------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S1**      | 1     | FK-1                                                                                                                                                                                                                                                                    |
| **S2**      | 7     | GOV-1, ACT-1, EDIT-1, SSE-1, SEC-2, CHROME-1, TITLE-1                                                                                                                                                                                                                   |
| **S3**      | 27    | DEV-1, KEYCHAIN-E2E, E2E-GGG, IMPORT-1, D19-1, WS-1, LOG-1, BOOT-1, SKS-2, CHART-1, FILTER-1, LOGIN-DETAIL, NET-1, DRIFT-1, OVERLAY-I18N, NOW-1, SUPPORT-1, ENV-1, NOOP-1, TRAVEL-DOC, NOTES-1, DEC-1, CHANGELOG-1, PRIVACY-1, ENC-1, FAQ-1, A11Y-1/2/3 (3) + TEST-1..7 |
| **S4**      | ~30   | batched below                                                                                                                                                                                                                                                           |
| **Refuted** | 9     | SKS-REGEN (3 reporters), IMPORT-ARMS-BUY, RADAR-4, RADAR-2-HEAD, PRELOAD-LATCH, DRIFT-FAILMODE, D3-UNRECORDED, CHANGELOG-SEMVER, BUY-FAQ-INSINUATION                                                                                                                    |

---

## S1 — blocks merge (never deferrable)

### FK-1 · `apps/server/src/search/search-manager.ts:1006` → `:524` (+ `db/schema.ts:24`, `search-manager.ts:534`)

**What:** `importSearches()` in **replace** mode calls `this.remove(entry.id)` →
`database.delete(searches)`. The declared `ON DELETE CASCADE` on `hits.search_id`
**fires**, destroying the search's entire hit history. The import reports success.
Proven end-to-end against the real `SearchManager`:

```
import(replace) -> {"imported":1,"skipped":0,"errors":[]}
HITS before=1 | HITS after=0    >>> DATA LOSS
```

**Why it matters:** silent, irreversible, and on the **restore** path — precisely when a
user expects preservation. There is no recovery: import only restores searches; hits
export is a separate CSV endpoint with **no import counterpart**.

**Root cause — a false invariant in recorded memory.** The project memory
(`db-and-export-import-notes.md`) states _"SQLite `foreign_keys` is OFF — declared
cascades don't fire"_, and the earlier export/import review **dismissed this exact
finding as inert on that basis**. The premise is false: better-sqlite3 compiles with
`SQLITE_DEFAULT_FOREIGN_KEYS=1` (`better-sqlite3/deps/defines.gypi:14`), so FK
enforcement is **ON by default**. Verified through the project's real `openDatabase()`:

```
PRAGMA foreign_keys = 1 | hits before=1 | hits AFTER search delete=0  >>> CASCADE FIRES
```

The memory's reasoning ("SQLite defaults FK OFF") is true of _vanilla_ SQLite and false
of this build. This invariant was injected into all 9 reviewers as authoritative;
`review-performance` contradicted it correctly with measured evidence.

**Corollaries now live:**

- `swapWatcherRow` (`search-manager.ts:551-555`) survives **only by statement ordering**
  — it re-points hits _before_ deleting the old row. Reverse those two statements and
  hit history dies silently.
- `schema.ts:131-132` reasons as if cascades _do_ fire, contradicting `schema.ts:24` and
  `search-manager.ts:534` — the tree is self-inconsistent.
- Migration `0002`'s `PRAGMA foreign_keys=OFF/ON` are **no-ops** — SQLite ignores that
  pragma inside a transaction and Drizzle wraps migrations in `BEGIN`/`COMMIT` (proven).

**Fix:** see FIX-1. Correct the memory, `schema.ts:24` and `search-manager.ts:534` in
the same commit — _a wrong invariant in memory propagates into every future review and
every future delete path._

---

## S2 — blocks merge unless deferred with owner + ticket

### GOV-1 · `apps/server/src/ratelimit/rate-limit-governor.ts:63`

**What:** a caller already sleeping in `acquire()` fires into an **active 429 lockout**.
The comment at `:48` states the intent ("the global pause can move while we sleep for a
policy slot") but the re-check compares against the **stale** `slot`, not the current
`globalPauseUntilMs`. Since `sleep(waitMs)` overshoots, `Date.now() >= slot` is always
true on wake → early return → the `for(;;)` loop never iterates and the pause re-check
is **dead code**. Reproduced: 429 at t=423 imposing a 60 s lockout → the parked caller
fired at t=923, **59.5 s inside the lockout**.

**Why:** `request()` (`trade-api.client.ts:541`) is the single chokepoint for every GGG
call, and multiple callers (round-robin poll, deal derive, market sweep, price check,
travel) routinely park in `acquire`. When one 429s, every parked caller wakes and
fires → each 429s → each calls `pauseAll` from a later `now` → **the lockout extends**.
That is exactly the "lockouts stack" hazard hard rule #4 and D-16 exist to prevent, on
the operator's **real** PoE account. The existing test only starts `acquire` _after_ the
429, so it structurally cannot catch this.

**Fix:** FIX-2 (validated by the verifier: all 25 governor tests pass, no spin).

### ACT-1 · `apps/server/src/activity/activity.service.ts:118` (+ `:50`, `:212`)

**What:** the new PERF-1 prune **never fires after boot**, and an in-memory Map leaks.
`onTravel` finalizes a record only on `phase === 'failed'` (`:118`); a **successful**
travel persists with `finishedAt: null` and waits for a terminal **buy** event that, on
the default path, never comes. `persist` only increments `finishedSincePrune` when
`finishedAt !== null` (`:212`) → the counter stays 0 → `pruneActivity()` runs only at
bootstrap. Measured against the real service:

```
ACTIVITY_MAX_ROWS=50, 500 successful travels
-> rows_in_table=500, first_outcome=in-progress, finishedAt=null,
   openByListing_entries=500, finishedSincePrune=0
```

**Why:** **corrected reason** — all four reporters led with "Windows/Linux and macOS
without Accessibility", but `autoBuy` **defaults to `false`** (`db/schema.ts:12`,
opt-in per D-19). So this leaks on the **default path of every platform**, including a
fully-permissioned Mac. Two leaks, not one: the unprunable `activity` table (a multi-KB
row with full `ItemDetail` + steps JSON per travel) **and** an unbounded `openByListing`
Map. It violates the invariant the code itself documents at `:222` ("Bounded growth
(architecture.md invariant)"). The rubric names "resource leak" as an explicit S2
exemplar. Rows also display `outcome: 'in-progress'` forever.

**Note on the fix:** `emit('unsupported')` is **dead code** — no emit site exists, and
the `events.ts:111-113` doc comment claiming otherwise is wrong. Two reviewers proposed
"have `maybeBuy` emit `unsupported` on its early returns"; that would label every
ordinary travel-only run as an "unsupported buy" in the operator's feed. See FIX-3.

**Not a race:** definitively settled — better-sqlite3 is synchronous and `RealtimeBus`
is single-threaded, so `persist` and `pruneActivity` cannot interleave. (Were it
possible it would be benign: `INSERT … ON CONFLICT DO UPDATE` supplies all columns.)

### EDIT-1 · `apps/server/src/search/search-manager.ts:512-513`

**What:** `editSearch` bypasses the room gate and the durable `halted` marker. Every
other start site (`startEnabledWatcher:1208`, `restartViaDrip:720`,
`startPendingWatchers:1446`, boot reconcile `:270`) routes through `isEligibleToRun`
(archived + enabled + `detectionPaused` + `roomEnabled`); `editSearch` checks only
archived + `detectionPaused` + `enabled`, then calls `startWatcher` directly.
Reachable via `PATCH /api/searches/:id` with a new trade URL.

**Why:** two confirmed consequences — (1) a member of a **disabled room** that gets
re-pointed **starts detecting**: ws connect + budget spend in a room the operator
paused (violates D-room-1 v2); (2) a **halted** search that gets re-pointed starts its
engines while `publishEngineStatus:1772` forces the display back to `'halted'` — the row
**shows `halted` while the socket is live and burning budget**, and the sweep's
stability-clear (`:1343`) runs _before_ `if (health.halted) continue` (`:1355`), so it
**silently self-revives** after `DEGRADED_CLEAR_STABLE_MS`. That defeats plan 44's
"revived only by an explicit per-search act". `isEligibleToRun`'s own comment says
"this is the ONE place the gate set is spelled out, so a forgotten gate can't recur" —
and `editSearch` doesn't call it.

**Fix:** FIX-4.

### SSE-1 · `apps/server/src/server.ts:81` + `apps/desktop/src/main.ts:223-236`

**What:** the SSE stream blocks `app.close()` forever. `NestFactory.create()` is called
without `{ forceCloseConnections: true }`, so Nest never wires `trackOpenConnections()`
and `close()` waits on every open connection. The web client holds a permanent
`EventSource('/api/events')`. **Executed**, not reasoned:

- **Desktop Cmd+Q:** `before-quit` fires while the renderer's SSE is live →
  `preventDefault()` → `app.close()` **hangs** → `app.exit(0)` never runs → **the first
  Cmd+Q silently does nothing**; a second hits the `quitting` early-return and quits
  with no teardown. (Closing via the window X works — which is why this survived.)
- **Standalone:** `enableShutdownHooks()` sets `receivedSignal = true` and ignores every
  subsequent signal → **SIGTERM/Ctrl+C ignored twice; only SIGKILL ended it.**

**Why:** a public user's normal quit gesture appears to do nothing, then the app
force-quits without teardown. No crash reporting exists to reveal it.

**Fix:** FIX-5.

### SEC-2 · `apps/server/src/session/login-capture.service.ts:60-78`

**What:** the login Chrome's CDP port serves the PoE cookie jar **unauthenticated** to
any local process. `--remote-debugging-port` is loopback-bound, but CDP has **no auth** —
any local client can call `/json/version` then `Storage.getCookies` and read POESESSID,
exactly as our own `fetchCookies()` does. `debugPort = 9222 + random(1000)` is
obscurity, not a control (scan 9222–10221 in milliseconds).

**Why:** hard rule #3 makes the session a credential — the API never returns it, and at
rest it is AES-GCM behind an OS-wrapped key. CDP serves it **in clear**. This is an
escalation over reading Chrome's own profile (that jar is keychain-encrypted). Loopback
is not a boundary against other local processes — the assumption that made this
acceptable for one operator's own Mac.

**Scope correction:** macOS-only in practice — `CHROME_BINARY` defaults to a macOS path
and nothing sets it in packaged builds, so `login/start` fails at spawn on Win/Linux
(see CHROME-1). Window is bounded to ≤5 min (`CAPTURE_TIMEOUT_MS`), realistically
~30–60 s. **Not S1** — it needs a local process already running plus a narrow window.

**Fix:** FIX-6. _This is the one finding the verifier said it would hold a public
release on._

### CHROME-1 · `apps/server/src/config/env.ts:248-251` _(upgraded S3→S2)_

**What:** `CHROME_BINARY` defaults to `/Applications/Google Chrome.app/Contents/MacOS/
Google Chrome`, consumed at `login-capture.service.ts:65` → `spawn` → `'error'` →
`fail()`. On the Windows and Linux builds `release.yml` already produces, the in-app
Chrome login is dead on arrival.

**Why upgraded:** evidence the reporter didn't have —

- `apps/desktop/src/main.ts:14`: _"Deliberately deferred: … BrowserWindow login
  (Phase 4/5)"_ — there is **no** Electron login path; the desktop depends on this spawn.
- The login UI ships from `apps/web/` (same build, served via `STATIC_DIR`) —
  **ungated on every platform**.
- It is in the **first-run `OnboardingWizard`**, not a settings corner.
- D-12 makes the two auth paths **equal citizens** ("neither is a fallback"), so
  cookie-paste does not demote it.

Rubric S2 is "likely bug in a core path". This is a _certain_ bug in an **auth** path,
on 2 of 3 shipped platforms, in first-run onboarding. `installerSuffixForPlatform`
(`update.service.ts:12-17`) is the in-repo precedent for a platform-keyed default.

**Fix:** FIX-7.

### TITLE-1 · `apps/desktop/src/main.ts:94-95`

**What:** `titleBarStyle: 'hidden'` + `trafficLightPosition` applied
**unconditionally**; the only platform guard in the file is `:74` (dock icon). No
`titleBarOverlay` anywhere. `apps/web/src/index.css:88-90` applies an 84 px
traffic-light inset to _any_ `data-shell='desktop'`, and `:82-84` sets
`.app-window-controls { width: 0 }` — reserving nothing where Windows controls belong.

**Why:** settled from the installed Electron 41.7.2 `electron.d.ts` without a build —
`titleBarStyle` carries **no `@platform` tag** (`:3946-3948`), while siblings do
(`trafficLightPosition` → `@platform darwin`, `thickFrame` → `@platform win32`); and
`setTitleBarOverlay` is tagged `@platform win32,linux` (`:3480`), which is only coherent
if `hidden` strips native controls there. So **Windows and Linux both ship a window with
no minimize/maximize/close buttons** (Alt+F4 only) plus an 84 px dead gap. _(Corrects
the reporter, who thought Linux was unaffected — it gets the same broken window.)_

**Fix:** FIX-8. **Open sub-question:** whether the default menu bar still renders on
Win/Linux under `hidden` — would be either an extra visual defect or the only close
affordance. Needs a real NSIS/AppImage build.

---

## S3 — fix in PR or track

**Security / platform**

- **DEV-1** · `config/env.ts:10` + `app.module.ts:52` — `APP_ENV` defaults to
  `'development'` and `configureEnvironment()` never sets it, so **every packaged build
  registers `DevModule`** (`/api/dev/return-hideout-probe` types `/hideout` into the live
  client; `/capture-probe`; `/move-test`). _Downgraded from S1 by three converging
  arguments:_ no marginal attack surface (the loopback API is unauthenticated **by
  design** — `POST /api/travel`, `/api/travel/retry`, `/api/buy`, `DELETE /api/session`
  are all already reachable and offer strictly _more_); the permission push is inert in
  packaged builds (`dev.controller.ts:52` gates on `instanceof PushedPermissionProbe`,
  which packaged never is — the capability gate **cannot be spoofed**); `capture-probe`
  returns no pixels; `return-hideout-probe` takes no body params; and it is **dead on 2
  of 3 targets** (off-darwin probe → `'unsupported'` → `requireGrant` throws). Hard rule
  #5 is **not** bypassed — the rule is "never _default_ auto-travel on", and a `/hideout`
  self-teleport is not auto-travel-to-a-seller. **Still a real defect:** a module whose
  own comment asserts it is dev-only ships in every public build. FIX-9.
  **Process finding:** the 2026-07-10 record dismissed this exact surface at `:97`
  ("`APP_ENV==='development'`, so it is not a production hole") and prescribed no change
  — a prior review's refutation that failed the hostile-until-proven-safe bar, and was
  _self-sealing_ (SEC-2's fix was "covered transitively — no separate change needed").
- **KEYCHAIN-E2E** · `platform/noop-platform.ts:59` + `server.ts:79` +
  `playwright.config.ts` — `loadKey()` is **not read-only**: on a find-miss it runs
  `security add-generic-password`. e2e boots with `APP_ENV: 'test'` →
  `createNoopPlatform()` → the **real keychain store**; `e2e/api.spec.ts:48` pastes
  cookies → `save()` → `encrypt()` → `loadKey()` → **the developer's real login
  keychain**. Falsifies the file's own safety claim. Same class as the recorded "e2e
  wiped the real session" incident. FIX-10.
- **E2E-GGG** · `playwright.config.ts:18` + `e2e/api.spec.ts:30,54,63` — `DB_PATH:
'./data/e2e.db'` is persistent and never reset. If a run aborts between the cookie
  paste (`:54`) and the delete (`:63`), the session row survives; the next run's
  "add-without-session → 400" test no longer hits `NoSessionError` →
  `search-manager.ts:327` calls `tradeApi.resolveQuery(ref)` → **a live request to
  pathofexile.com** from the operator's IP. Breaches hard rule #8. (`APP_ENV=test` only
  disables the boot probe; it does not stub the trade-api client.) FIX-10.
- **IMPORT-1** · `export-import/import.service.ts` — no confirm/warning on import;
  `autoTravel` survives for `'securable'` queries. _(The S1 claim that import silently
  arms **auto-buy** was **refuted** — `search-manager.ts:1008-1020` gates it via
  `assertAutoBuyAllowed` → `canControl()`; the reporter never read `importSearches()`.)_
- **SKS-2** · `secret-key-store.electron.ts:64-67` — a transient disk failure
  (read-only FS, full disk) → `writeFileSync` throws → `return null` → `SessionCipher`
  returns null → `db-session-store.ts:43` stores the raw `SessionState`. D-21's
  "no OS secret store → plaintext, loudly warned" was scoped to a _keyring-less machine_,
  not a transient write error.

**Reliability / correctness**

- **D19-1** · `search-manager.ts:1015` — `if (!autoTravel) autoBuy = false;` contradicts
  D-19, which **explicitly supersedes** it. **Delete line 1015 only** — the surrounding
  `canControl()` gate at 1008-1020 must stay (it is what refutes the import S1).
  _Reason understated by the reporter:_ `assertAutoTravelAllowed` returns early when
  `autoTravel` is false, so the dominant case is `autoTravel=false, autoBuy=true` —
  a fully legal state under D-19.
- **WS-1** · `engines/ws-engine.ts:105-111` + `session/db-session-store.ts:24-39`
  _(merged — same root cause, two reports)_ — the no-session path is a fixed **1 Hz**
  retry that never climbs the ladder (`WS_RECONNECT_LADDER_MS[0]`), and
  `isEligibleToRun` never checks the session, so a signed-out boot starts every engine
  into it. Each iteration re-runs a guaranteed-failing decrypt, re-logs a warn, calls
  `recordWs` (churning the 500-entry ring, evicting real diagnostics), does
  `existsSync`+`statSync` **on the event loop**, and publishes an SSE forcing an O(1000)
  copy + context-wide re-render. Does **not** reach GGG (no socket opened), so
  OutboundGuard cannot catch it — hence S3, not S2.
- **LOG-1** · `server.ts:68-86` — _(downgraded S2→S3: an observability gap, not a
  core-path bug)_ no `useLogger()`/file transport; the packaged build **discards its
  entire application log**. Invisible in production: the `ProcessBackstop`'s unhandled
  rejections, `GUARD TRIPPED`, decrypt failures, activity errors. `LOG_DIR` exists but
  `network.log.jsonl` carries only redacted GGG lines, never exceptions. Compounding:
  the `LogEvent` channel that _does_ exist is dropped by the web reducer
  (`case 'log': return state;`). Distinct from the known "no crash reporting" blocker —
  that covers deaths; this covers the app running **wrong while alive**.
- **BOOT-1** · `apps/desktop/src/main.ts:211-214` — boot failure quits silently
  (`console.error` → discarded → `app.quit()`). Reachable via a bad env, a migration
  failure on a force-killed DB, or `EADDRINUSE`. The user double-clicks and **nothing
  happens, forever**. Fix: `dialog.showErrorBox()` before quitting.
- **ENV-1** · `.env.example:1` + `docs/operations/run.md:12` — **the documented
  config-delivery mechanism is dead code.** Zero `dotenv`/`--env-file`/`loadEnv` in any
  source, script, vite/playwright config, husky or CI (the 7 lockfile hits are
  transitive build-tool deps). It stayed invisible because every uncommented key in
  `.env.example` is **byte-identical to its schema default** — and the local untracked
  `.env` is a byte-identical _prefix_ of `.env.example` (copied, never edited). Vite does
  not mask it (`envDir` = `apps/web/`, zero `import.meta.env` uses). _Correction: this
  does **not** make `CHROME_BINARY` unfixable for packaged users — they have no checkout
  and no `.env` either way. Don't couple the two._
- **NOOP-1** · `platform/noop-platform.ts:12,59` — the file says "Every capability
  inert" and its aggregate's contract says "the no-op default keeps the server
  cross-platform and testable", but `secretKeyStore` wires the **real** macOS keychain
  store. The file grew a paragraph explaining why it violates its own name. Concrete
  harm = KEYCHAIN-E2E above. _(The "zero native deps" half of the doc claim is **still
  true** — `execFileSync('security')` is a subprocess, not a native import.)_

**Frontend**

- **CHART-1** · `search-panel/DealTrendChart.tsx:49-58` — mounted with `<2` samples, the
  early returns at `:60`/`:67` mean the `ref` div isn't in the tree; the `[]`-deps
  `ResizeObserver` effect finds `containerRef.current === null`, never observes, never
  re-runs → `containerWidth` 0 → `geometry` null → **permanently blank chart**.
  `DealHistoryCard.tsx:33-46` refetches without remounting, so the 2nd sample never
  heals it. Closing/reopening the panel does.
- **FILTER-1** · `pages/HitsPage.tsx:91-119` — a filter change is **silently dropped**
  if a fetch is in flight (`:93` early-returns on `loadingRef.current`; nothing re-fires
  on settle). The Select shows the new filter; the list shows unfiltered results and
  never self-corrects. `useSearches.ts:76-91` already implements the correct
  `latestRequestId` sequencing for this exact hazard.
- **LOGIN-DETAIL** · `shell/LoginOverlay.tsx:63` + `pages/SettingsPage.tsx:591` —
  `loginDetail` rendered raw, and `login-capture.service.ts:79` sets it to a **raw Node
  exception**. Combined with CHROME-1, `cannot launch Chrome: spawn … ENOENT` (with a
  macOS path) is the **guaranteed first-run output** for every Windows/Linux user, in
  English, to a PL audience. `frontend.md:78-79` sanctions this — **the doc is stale**:
  the sibling case (engine `statusDetail`) has already been migrated away, and
  `packages/shared/src/engine-status-detail.ts:1-9` states the opposite rule in the
  codebase's own words. Fix the doc too.
- **NET-1** · `hooks/useNetworkView.ts:11-14` — the developer Network view **defaults
  ON** (`getItem(KEY) !== '0'` → true on a fresh install), making `nav.ts:51`'s
  `devOnly` flag inert. Every public first-run user gets a "Network" rail item of raw
  GGG request logs. **Not a leak** — independently verified: `NetworkLogEntry` has no
  header/cookie field and `extractRateLimitHeaders` allow-lists `x-rate-limit*` only.
- **DRIFT-1** · `hooks/useServerStatus.tsx:25-46` + `useLoginCapture.ts:5-8` — the web
  hand-mirrors two wire contracts; already lossy (`lastTravel.phase` widened from a
  4-member union to `string`; `CaptureStatus.state: string` vs the server's
  `LoginCaptureState`). *(The claimed failure mode was **refuted** — it's inverted: a
  `!==` guard makes the poll stop *early*, it cannot leak. And `lastTravel` has zero web
  consumers. Both server types live outside `packages/shared`, so the fix needs a shared
  move first.)*
- **OVERLAY-I18N** · `apps/desktop/src/overlay/price-check-overlay.ts:91,106,108` — the
  price-check overlay is **entirely un-i18n'd** (`'Item'`, `'No comparable listings.'`,
  `'Price unavailable.'`), plus no `lang` on the `<html>`. It bypasses the catalogue, so
  D-22's "missing PL key is a build error" never fires — exactly the bypass D-22 exists
  to catch, on the visible output of a headline feature.
- **NOW-1** · `pages/SearchesPage.tsx:958-972` — the `nowMs` tick is suppressed while any
  panel is open, but `nowMs` feeds **three** consumers, not the one it was written for:
  hit-highlight aging (intended), the plan-43 degraded duration (`:685`), **and**
  `isSpotlightFresh` (`:1209`). Investigating a degraded search _is_ opening its panel —
  which is exactly when its duration stops advancing.
- **SUPPORT-1** · `config/support.ts:67-69` + `AboutPage.tsx:96` _(uncommitted)_ — all
  three `DONATION_LINKS` are `''`, but `hasAnySupportLink()` returns true, so the tip
  blurb renders **with no tip buttons**: _"If it's saved you time or divines, a small tip
  keeps it growing. 🙏"_ → _(nothing)_ → _"Not into money? These help too:"_. The doc
  comment is inverted. **Stronger than filed:** `PROJECT_LINKS` are built from a
  hardcoded `REPO_URL`, so `hasAnySupportLink()` is **structurally always true** and
  `about.comingSoon` is unreachable dead code in both catalogues.

**Accessibility**

- **A11Y-1** · `components/Modal.tsx:28-66`, `shell/OnboardingWizard.tsx:286-321`,
  `shell/LoginOverlay.tsx:23-25` — **three** dialog implementations, none with initial
  focus, a Tab trap, or focus restore. `LoginOverlay` has no `role="dialog"`/`aria-modal`
  /label at all. `aria-modal="true"` tells AT to hide everything outside the dialog while
  focus starts **outside** it — so a screen-reader user on first run tabs through content
  their AT was told to ignore. DOM order confirmed: the wizard mounts second-to-last, so
  reaching "Next" means tabbing the app bar, rail, **every search row** and the hits panel.
- **A11Y-2** · `shell/HitsPanel.tsx:81-85` + `components/HitCard.tsx:64-69` — the
  `aria-live="polite"` region wraps the scrolling list while `nowMs` re-renders every 5 s
  and `formatRelativeMagnitude` returns second granularity under a minute → each fresh
  hit re-announces ~12× in its first minute, **drowning the actual new-hit
  announcement**. The live region defeats its own purpose. (`lib/notifications.ts` is a
  genuine parallel channel → degradation, not lockout.)
- **A11Y-3** · `index.css:18` `--color-ink-faint: #5d574c` — **2.76/2.61/2.42/2.21** on
  surface-0/1/2/3. Fails AA (4.5:1) _and_ the 3:1 large-text floor everywhere; 146 call
  sites. Independently recomputed — all 24 ratios matched to two decimals. Load-bearing
  sites are exactly the strangers' strings: `AutomationCard.tsx:88` (**the reason the Buy
  toggle is disabled** — the D-18 flagship case), `Field.tsx:15` hints (cookie-paste
  instructions), `OnboardingWizard.tsx:48` disclaimer — all at `text-[11px]`/`text-xs`,
  so **small-text AA applies**. The reporter explicitly did _not_ report the D-8 gold
  palette (measures 8.71:1) — correct restraint; this is one token, not the design
  language.

**Docs / consistency** _(all release-gate, not merge-gate)_

- **PRIVACY-1** · `README.md:120`, `README.pl.md:130`, `i18n/messages.ts:279` + `:939`,
  `docs/operations/packaging.md:78` — _"The only server it ever contacts is
  pathofexile.com"_ is **false**: `market-data/poe2scout.client.ts:7` calls
  `api.poe2scout.com` and `update.service.ts:67` calls `api.github.com` (and
  `api-notes.md:247` documents poe2scout as "NON-GGG"). It is shown **inside the
  onboarding wizard in both languages**. `CHANGELOG.md:65-68` claims this was fixed this
  session but **only the README bullet moved** — the FAQ 60 lines below still denies it,
  so `README.md` now contradicts itself. _Reality is benign_ (poe2scout is
  user-initiated price-check only; the update check is repo-gated; nothing leaks but an
  item name and a version string) — false claim, benign reality. **Fix this one now:**
  it's in-app, trivial, and unblocked by any open decision.
- **FAQ-1** · `README.md:100-111` — _"never automates gameplay (no auto-buying, no
  botting, no movement scripts — it only requests a hideout-travel)"_ is **false**:
  `buy-automation.service.ts:282-291` drives `pressKey('escape')` → `pressKey('enter')`
  → `typeText('/hideout')` → `pressKey('enter')` into the live client, plus cursor
  control. The app's own gate string says "grant … to enable **auto-buy**".
  _However — "Does it buy items for me? **No**… you complete the trade manually" is
  **TRUE and structurally guaranteed**: `InputController` has **no click method at all**
  (`platform/ports.ts`), zero click calls repo-wide. D-20 is enforced by the port
  surface._ **Do not rewrite the FAQ yet** — the text depends on O-12's unmade decision
  (ship / gate-off / omit); rewriting now silently pre-empts it.
- **ENC-1** · `README.md:44-45`, `README.pl.md:47-48` _(upgraded S4→S3)_ — "Your session
  is encrypted at rest in your OS keychain" stated unconditionally; O-13 records that a
  keyring-less Linux box falls back to plaintext, and Linux is a promoted platform. A
  false claim about a **credential** (hard rule #3) — same harm class as PRIVACY-1.
  Owned by O-13, due "before the first tag".
- **NOTES-1** · `docs/notes-from-memory.md` — **tracked, in HEAD, and the repo is
  PUBLIC**, so it is live at a public URL today. 115 lines of **Polish** (hard rule #7),
  stale to self-contradiction (`:18` "repo jeszcze NIE istnieje", `:10` "NO REMOTE/push",
  `:20` "stary prototyp … NIE DOTYKAĆ" — inverting hard rule #1), carrying
  `originSessionId: 70647f45-…` and naming **card-bridge** as the standards source. Zero
  inbound references. **Delete.**
- **TRAVEL-DOC** · `docs/architecture/travel.md:52-56` — says a failed travel "stops
  there", but the code has both a manual retry (`travel.service.ts:130`) and an
  **automatic** one (`retryAutoFailure:280-298`). _Not a decision violation_ — D-13's own
  text says "no retries … **until the API path rejects in practice**", and it did; the
  retry is auto-source-only, retryable-reasons-only, single-flight, budget-gated, exactly
  one attempt. **D-13's escape hatch fired as designed.** The defect is purely the stale
  doc + the unrecorded amendment.
- **DEC-1** · `docs/planning/40_decisions.md` — the preamble promises "Append-only. Every
  entry: id, date, decision, rationale, commit id", but `D-room-1`, `D-dw-3`, `D-dw-11`,
  `D-dw-14`, `D-dw-19`, `D-dw-21`, `D-pc-2`, `D-pc-4` have **0 occurrences** — they exist
  only in per-feature plans while **code comments cite them as log entries**
  (`poe2scout.client.ts:53`, `market-data.module.ts:8`, `exchange-rates.service.ts:48`,
  `deal-watch.service.ts:72-73`, `deal-baseline.service.ts:19`). Violates the workflow
  rule: _a decision discussed but not written down is lost._
- **CHANGELOG-1** · `CHANGELOG.md:63` and `:158` — `[Unreleased]` has **two `### Fixed`
  headings**, and `:140-157` under the first are ~10 unambiguous **features** (rate-limit
  slider, deal-watch UI + server core, About & Support, macOS permissions, **Per-search
  Buy automation**, DB export/import). Per the README's own release recipe, the first tag
  would announce the most ToS-exposed feature under "Fixed". _Worth noting:_ the CHANGELOG
  entry is the **most honest description of Buy in the repo** ("it focuses the game …
  and moves the cursor onto the item. **It never clicks**") while `README.md:105` denies
  the feature exists.

**Testing** (TEST-1..7 — all coverage gaps; the rubric puts "missing test for new logic"
at S3 **by definition**, so all three reporter-claimed S2s were corrected down)

- **TEST-1** · `apps/desktop/src/platform/secret-key-store.electron.ts` — the entire D-21
  envelope adapter has **zero tests**. `apps/desktop/vitest.config.ts:6-8` justifies the
  omission with "the Electron/nut.js/uiohook adapters need hardware" — **false for this
  adapter, and load-bearing false**: the verifier wrote a 4-test probe (`vi.mock('electron')`
  - `vi.mock('node:fs')`) covering mint+`0o600`, `basic_text`→null, regenerate, and the
    memo — **4 passed in 89 ms, no Electron runtime**. Narrow that comment as part of the fix.
- **TEST-2** · `session/db-session-store.ts:30-35` — the new "decrypt failure → signed
  out" catch is untested. _(The reporter's "bricked with no way to re-login" is **false**:
  `setFromCookies()` calls `save()` **before** `publicStatus()`, so re-login self-heals.
  Correct consequence: status endpoints 500 until the user re-pastes cookies.)_
- **TEST-3** · `db/migrate.test.ts:20-30` — **the idempotency test never re-runs
  migrations.** It opens `:memory:` (verified: a fresh private DB per connection) so
  `migrate()` runs for the _first_ time; `count > 0` cannot observe the property the name
  promises. Passes either way. _Additionally:_ idempotency is **drizzle's** invariant, not
  ours (proven on the real leftover e2e DB: re-opening applied only pending 0004–0014).
  **Replace it, don't fix it** — the test the suite actually lacks is _forward-migration
  onto an older DB_. Also `arrayContaining` covers only 4 of ~14 tables.
- **TEST-4** · `activity/activity.service.test.ts:146-206` — PERF-1 tests cover only the
  **boot** prune; zero references to `PRUNE_EVERY_N_FINISHED`/`finishedSincePrune`. The
  untested branch is exactly where ACT-1 lives. Same gap mirrored at
  `search-manager.ts:1728` (`PRUNE_EVERY_HITS`). _(Credit: the existing tests assert
  intent — oldest dropped, `item-5` kept — they don't re-stamp output.)_
- **TEST-5** · `e2e/api.spec.ts:91-103` — the SSE test **asserts nothing**: the comment
  admits "a timeout abort is the expected outcome" → `.catch(() => null)` → the
  `if (response)` block never executes on the documented-expected path. Also green if the
  server is down.
- **TEST-6** · `engines/ws-engine.test.ts` — 54 lines for a 274-line core engine. Two
  branches are reachable with **no socket** via the public `start()` API and are untested:
  `:104-110` no-session → `degraded/no-session` + retry, and `:111-118` guard-tripped →
  `degraded/guard-halted` + **no retry timer** (a D-16 requirement). The existing test
  already builds a WsEngine with the right fakes — it just never calls `start()`. Hard
  rule #8 is no excuse.
- **TEST-7** · `packages/shared/package.json:18` — `"test": "echo \"no tests: types
only\""` is **false and silently excludes the package from `pnpm -r test`**.
  `travel-failure.ts` is a 10-rule behavioural registry (regex-disambiguated GGG code-2 →
  `not_in_town`/`own_listing`/`not_in_game`, a `RETRYABLE_REASONS` set, a `?? 'unknown'`
  fallthrough); `trade-url.ts:15` does `encodeURIComponent(league)`. Zero direct test
  references; a `.test.ts` added there **would never run**.

---

## S4 — batch, non-blocking

`AUDIT-1` audit-suppression comment wrong for multer (a **runtime** dep via
`@nestjs/platform-express`, not build tooling; suppression still sound — no multipart
route exists) · `SKS-REGEN`↓ broad catch conflates transient/permanent (see Refuted) ·
`writeFileSync` `{mode:0o600}` ignored when the file exists (verified on Node 22.22.2;
practically inert — this code is the only creator and always creates at 0600) ·
DB file mode 0644 / dir 0755 (`chmod` 0600 + `{recursive:true, mode:0o700}`) — folds
into the O-13 resolution · `keychain-secret-key-store.ts:27` no key-length validation
(reporter could construct no realistic path) · `session-import-cli.ts` defaults to the
**retired** prototype's export path (verified: `~/Projects/poe2-live-sniper` does not
exist → uncaught ENOENT; hard rule #1) · `__enc` has no key-source marker (claimed
cross-DB path **refuted** — `session:import` uses `./data/dev.db`, desktop uses
`userData/sniper.db`) · `price-check-overlay.ts:95,100` unescaped `.amount` from an
unchecked cast (containment sound: `data:` URL, opaque origin, `sandbox:true`,
`contextIsolation:true`, and SEC-1 rejects `Origin: null`) · overlay theme tokens
duplicated from `index.css` · `useActivityFeed.ts:53-66` undebounced refetch ↓
(measured: **0.05–0.17 % of the thread** — the 118 KB/refetch is real but costs ~0.1 %
CPU; `HitsPage.tsx:70`'s 400 ms debounce is the in-tree fix) · no DB backup before
auto-migrate ↓ (code is defect-free; contingent on a _future_ bad migration — worth the
~5 lines before tagging) · `export.service.ts:110` unbounded `.all()` (compounds ACT-1;
resolves with it) · `travelStateByListingId`/`buyStateByListingId` never pruned (~100 B
× session hits ≈ 1 MB; neighbours cap at 100/1000) · `useServerStatus.tsx:72`
`.catch(() => setStatus(null))` blanks every card for ≤10 s on one transient poll ·
`useSearches` 6-instance fan-out ↓ (5 concurrent GETs on `/hits`; correct
`latestRequestId` sequencing means no risk — waste + inconsistency only) ·
`STATUS_DETAIL_KEYS` is `Partial<Record<…>>` → a new code renders nothing (all 7 mapped
today; `Partial` isn't needed — a full `Record` fixes it free) · `room-state-breakdown.ts:20`
doc claims the assertion "fails the build" — **it doesn't** (`readonly RoomStateBucket[]`
gives no exhaustiveness; it throws at runtime during render) · 3 hand-rolled icon buttons
vs the `IconButton` atom (`rounded p-1 text-ink-faint` vs `h-7 w-7` + `text-ink-muted`)
· SettingsPage logout's bespoke two-click + uncleaned `setTimeout` · `Tooltip`
`focusable` defaults true → ~5 dead tab stops per search row; `role="tooltip"` orphaned ·
`Select` `li[role=option]` wraps a `<button>`; no listbox name/`aria-controls`/Home/End ·
`Switch` has no disabled-reason hook; `AutomationCard:50-55` conveys global-pause via
`opacity-40` + `title` on a `<div>` (mouse-only) · `OnboardingWizard:299-302` `aria-label`
on a role-less `<div>` · `index.css:43-48` **unlayered cursor rule silently kills
`cursor-grab` on both DnD handles** (compile-verified: the rule emits at line 183 outside
any `@layer`, beating `@layer utilities` per Cascade L5 — both handles render `pointer`) ·
`DndContext` has no `accessibility={{announcements}}` → dnd-kit's EN defaults ship in a PL
session **and interpolate raw ids** (verified in `core.esm.js:43-91`) → "Draggable item
room:\<uuid\>" · contrast minors (`Button danger` 3.99, `Badge danger` 3.75, `ink-muted`
/surface-3 4.34, Switch OFF track 1.18, `border-edge` 1.31 — the D-8 aesthetic) ·
`AppBar:113-115` unseen-hits gold dot has no text/aria; `<aside>` unnamed landmark ·
`StatusBar.tsx:53` no `flex-wrap`/`min-w-0` → clips ~375 px (web shell only —
`main.ts:86` `minWidth: 900` means the Electron window can't go narrow) ·
`apps/web/vitest.config.ts:8` excludes `.test.tsx` (nothing masked today) ·
`platform.module.test.ts` + `no-native-imports.test.ts` both hand-maintained lists
(2 instances — a 3rd justifies deriving both from source) · `i18n` `PluralForms` makes
every form but `other` optional → a PL entry missing `few`/`many` silently degrades
(**all 4 PL entries verified complete**; latent only) · `interpolate`/`detectLanguage`/
`translateStatic` untested · Polish in English-only artefacts (`messages.ts:826,1231`
comments; `30_open_questions.md:20`; `41_deal_watch_plan.md:557-558,701` — `:557-558` is
a verbatim operator quote, defensible; D-17) · `40_decisions.md:21-25` **D-8 and D-9 each
listed twice** in an append-only register · `docs/README.md:27-29` points decision history
at `~/Vault/…` on a public repo; omits `planning/`, `operations/packaging.md`,
`process/reviews/` · `docs/process/code-review.md` still promised by master plan §3,
still absent (rubric lives in `_standards`) · `architecture.md:20-25` omits
`apps/desktop`; `:11` calls a shipped shell "(Phase 5)"; `:38-50` omits `SecretKeyStore` ·
`architecture.md:30` + `trade-api.client.ts:98` "the ONLY module that talks to
pathofexile.com" is **literally false** (`ws-engine.ts:123` opens the socket directly with
cookies+UA) — **not a hard-rule-#4 breach** (the rule says "no `fetch`"; the ws path is
gated by `allowWsConnect` + `GUARD_MAX_WS_CONNECTS_PER_MINUTE`), a wording fix ·
`00_master_plan.md:27-32` stale paths + "the old prototype keeps running untouched"
(contradicts hard rule #1) · `2026-07-10` record still lists REL-1/PERF-1/BEACON/FE-2 as
open — **append** a superseded note, don't edit a dated snapshot · `statusDetailKey()`
domain logic in a page component, untested · `.env.example` lacks `ACTIVITY_MAX_ROWS`
(sibling `HITS_MAX_ROWS` is documented) · `secret-key-store.electron.ts:20` comment
"Build this AFTER `app.whenReady()`" — the factory is inert; the real constraint is on
`loadKey()` (which honours it) · retention logic duplicated 4× (see Radar).

---

## Verified-safe (aggregated CLEAN)

**D-21 `SecretKeyStore` — sound.** Envelope scheme correct: random 32-byte CSPRNG key,
AES-256-GCM, fresh 12-byte IV per encrypt, auth tag verified; no IV reuse, no hardcoded
key, no deprecated algorithm. One AES-GCM format on every OS — and returning a raw
`Buffer` (rather than an `encrypt`/`decrypt` `SecretBox` port) is **the right call**: a
cipher port would push safeStorage's opaque machine-bound blob into `app_state.value`,
forcing per-shell branches in `isEncryptedPayload` and the legacy-plaintext migration.
Linux `basic_text` detection correct and platform-gated. Malformed-key length check
catches hex truncation. `createSafeStorageSecretKeyStore()` correctly built after
`app.whenReady()`; `loadKey()` lazily cached. ISP holds at the consumer. Layering holds
(`platform` does not depend on `session`). `session-cipher.test.ts` genuinely covers
tamper, wrong-key, missing-key and lazy-load. `DbSessionStore.load()`'s degrade-to-
signed-out is the right call.

**`no-native-imports.test.ts` really guards** — walks all of `apps/server/src`, skips only
`*.test.ts`, regex-matches import specifiers; not tree-shaking-dependent. `apps/server`
imports zero native/Electron code; `secret-key-store.electron.ts` imports
`@poe-sniper/server` **type-only**. _(Adjudicated: real for direct imports; blind to
transitive reach, a native dep added to `apps/server/package.json`, computed
`import(variable)`, and — named by neither reviewer — the fact that `FORBIDDEN_MODULES`
is a **hand-maintained list of 6**. Residual low: server deps pull no native addon.)_

**PERF-1's prune query is correct and fast.** EXPLAIN verified: `SCAN activity USING
COVERING INDEX activity_started_at` + `CREATE BLOOM FILTER`, **no** temp B-tree (SQLite
treats the index as `(started_at, rowid)` and reverse-walks it). Measured 19.1 ms for
50k→2k. **`NOT IN` does not degrade** — cost tracks rows _deleted_, not set size
(keep=2000→20.4 ms; keep=20000→15.8 ms; keep=45000→11.4 ms). Index exists
(`0006_activity.sql:17`). `PRUNE_EVERY_N_FINISHED = 50` is **not** a config violation —
it mirrors `PRUNE_EVERY_HITS = 100` as an internal amortization constant; the actual
caps are in the Zod schema. Prune **cannot** race an in-flight record (single-threaded +
synchronous driver); were it possible it'd be benign.

**Hard rule #3 (session as credential) holds end to end.** `SessionPublicStatus` =
`{hasSession, capturedAt, cookieNames, probedValid}` — **names only, no values**;
`buildCookieHeader` is the sole egress; `recordHttp` passes no cookie/UA/token to
`NetworkLog`; `extractRateLimitHeaders` allow-lists `x-rate-limit-*` only. UI renders
names only; paste inputs `type="password"`, cleared on submit; `localStorage` holds UI
prefs only. gitleaks clean over 273 commits.

**Hard rule #4 holds.** Exactly two `fetch(` outside `trade-api/`: `update.service.ts:66`
(GitHub) and `login-capture.service.ts:114` (loopback CDP). Governor + `OutboundGuard`
front every GGG call; guard is manual-reset only (D-16). The ws path opens its socket
directly but is gated by `allowWsConnect` + the ws budget — letter and rationale both
satisfied.

**Hard rule #5 holds at rest and in the web UI.** `auto_travel`/`auto_buy` default
**false** at schema and migration level; `SearchesPage:195` `useState(false)`, `:318`
re-defaults; no web path pre-enables it. Server-side, `assertAutoBuyAllowed` gates on
live TCC.

**D-20's no-click guarantee is structural** — `InputController` has **no click method at
all**; zero click calls repo-wide.

**SEC-1 host guard is sound** — Host allow-list + **parsed-origin** comparison (not
prefix), `'null'` rejected, unparseable rejected; applied `forRoutes('*')`.

**Electron hardening** — `contextIsolation: true`, `sandbox: true`, `nodeIntegration:
false` on both windows; `setWindowOpenHandler` denies all; `will-navigate` compares
parsed **origins**. IPC = two fire-and-forget channels with a `satisfies`-checked
allow-list.

**Injection** — no `dangerouslySetInnerHTML`/`innerHTML`/`eval`/`new Function` anywhere.
All 7 raw-SQL sites use drizzle's `sql` tag with parameterised interpolation over
Zod-validated config numbers. CSV formula injection properly handled (`csv.ts:22`) —
`= + - @ \t \r` guarded on **text** cells only, RFC-4180 quoting correct.

**Option-B toggle (plan 44) is NOT colour-only** — the review's priming hypothesis was
**rebutted with evidence**. `STATUS_LABEL_KEYS: Record<EngineStatus, MessageKey>` maps
**all 7** statuses to distinct i18n text, and the `Record<>` type makes exhaustiveness
**compiler-enforced**, so it cannot silently regress. Colour is strictly additive.
Server derivation confirms the split (gate-held → `'paused'` → blue; user-off →
`'stopped'` → grey; `Switch.tsx:31` applies tone only when checked).

**Keyboard DnD works** (`KeyboardSensor` + `sortableKeyboardCoordinates`). **The
sparkline is available non-visually** — `role="img"` + `aria-label`, arrow-key stepping
with Escape, an `sr-only` `aria-live` readout, **and a full `sr-only` `<table>`** with
caption/th/td. `lang` tracks the locale switch. `prefers-reduced-motion` respected.
`IconButton` **requires** `aria-label` at the type level.

**i18n (D-22) is enforced by types** — `PL: Record<MessageKey,string>` makes a missing
**or stray** key a typecheck error; 546/546 keys present; all 13 EN↔PL-identical values
are legitimate (proper nouns, currency, the literal game clipboard format).

**BEACON and FE-2 (2026-07-10) are fixed — and better than prescribed.**
`AppShell.tsx:96-100` adds a `status==='degraded'` conjunct so a gate-held search with a
lingering `degradedSince` can't light the beacon, with **one** derivation point.
`SettingsCard.tsx:52-56` has the `actionBusy` guard **plus** `disabled` on Restart,
Archive and Delete.

**REL-1 backstop is implemented and correct** (`server.ts:54-66`) — covers both
`unhandledRejection` and `uncaughtException`, idempotent, logs stacks without touching
the session. **Adjudicated:** continuing on `uncaughtException` is **defensible** for an
unsupervised desktop app (exiting would make it vanish mid-session with no supervisor
and no crash reporter) — _contingent on LOG-1 being fixed_, since today it continues
into a log nobody can read.

**No import cycles** — zero `forwardRef` in the server. **`support.ts` `REPO_OWNER`**
consistent across all four sources (`git remote`, `main.ts:35`, desktop `package.json`,
`support.ts:76`).

---

## Coverage gaps (aggregated SCOPE — what was NOT reached)

- **No runtime/browser pass.** `review-browser` was deliberately skipped (no dev server).
  Computed focus order, real SR output, actual rendered contrast, and TITLE-1's window
  chrome are **static conclusions**. TITLE-1's Electron behaviour was settled from the
  installed 41.7.2 type definitions, not a build.
- **No packaged-artefact test.** DEV-1 was proven by running `loadConfig()` under the
  exact packaged env, **not** by booting a `.app` and curling `/api/dev/*`. Worth a
  5-minute manual confirmation on a real build.
- **Windows / Linux never executed.** CI is Ubuntu-only and never runs the
  native/Electron paths. TITLE-1, CHROME-1, the Linux `basic_text` → plaintext path, and
  the AppImage userData layout are all reasoned, not observed. The Linux permission claim
  rests on Debian/Ubuntu defaults, which vary by distro.
- **macOS keychain-ACL behaviour** on an unsigned-build update cycle (drives SKS-2's
  neighbourhood) — needs hardware.
- **safeStorage on Windows (DPAPI)** — no Windows host available.
- **Native adapter internals** (nut.js / uiohook / desktopCapturer / CV thresholds) —
  the known O-6/O-7/O-8 hardware gap, unchanged by this session.
- **`LICENSE`, `THIRD-PARTY-NOTICES.md`, `scripts/generate-third-party-notices.mjs`**
  landed mid-review and were **not** reviewed by the specialist pass.
- **Dependency contents** — advisory metadata and dep trees only; no supply-chain review
  of package source.
- **Live GGG behaviour** — untouched by design (hard rule #8). `live-offer-registry.ts`'s
  `entry.listingIds` Set growth could not be magnitude-checked without live traffic.

---

## Refuted (did not survive verification)

- **SKS-REGEN — the three-reviewer consensus was wrong.** Reported by reliability (S2),
  correctness (S3) and security (S3): "any `decryptString` throw overwrites the only copy
  of the wrapped key → permanent session loss", with "the unsigned build makes keychain-
  ACL churn _likely_". **The chain fails at step 3:** a keychain Deny/lock makes
  `isEncryptionAvailable()` return **false** → `encryptionIsReal()` false → `read()`
  returns null → the write is **never reached**. The truly transient path is far narrower
  (a `readFileSync` I/O error on a 0600 file the app owns), and the dominant catch case
  (OS store reset / different machine) is genuinely permanent, where regenerating **is**
  correct. Survives only as an S4 nit (one broad catch conflating two cases).
- **IMPORT-ARMS-BUY (S1)** — `importSearches()` **does** gate both flags
  (`search-manager.ts:1008-1020`, documented at `:983`). The reporter never read the
  function it accused. `autoBuy` is force-false on Windows/Linux always and on any Mac
  without both grants.
- **RADAR-4** (`osascript` in `apps/server` = a D-18/D-21 violation) — D-18 says "no
  **native deps**" and rationale "the web bundle must never transitively import native
  code"; `execFile('osascript')` is a child process. **Self-defeating:** D-21 itself put
  `keychain-secret-key-store.ts` in `apps/server/src/platform/` shelling the macOS
  `security` CLI, which the same reporter conceded was fine.
- **RADAR-2 headline** ("`AddSearchOptions` has no `input`") — `input` is a **positional
  parameter** (`search-manager.ts:318`). The "triplication" mistakes proper layering
  (wire shape / wire validation / internal API) for copies.
- **PRELOAD-LATCH** — `isMacDesktop`/`isDesktop` are plain expressions in the component
  body, not latched state; they re-evaluate every render. "Latch false → Buy permanently
  disabled" is unreachable.
- **DRIFT-FAILMODE** — inverted: `useLoginCapture.ts:38` is a `!==` guard, so a renamed
  enum makes the poll stop **early**, not leak forever.
- **D3-UNRECORDED** — "nothing records the death of the single-user premise" is false **in
  the very file audited**: `40_decisions.md:38` (D-22 rationale) says "That premise died
  when the project turned toward a public release."
- **CHANGELOG-SEMVER** — the claimed update-check collision doesn't exist: `release.yml`
  runs `scripts/set-version.mjs ${{ github.ref_name }}`, stamping the tag at build time →
  `isNewerVersion('0.1.0','0.1.0')` = false → correctly no banner.
- **BUY-FAQ insinuation** — "Does it buy items for me? No" is **true and structurally
  guaranteed** (no click method exists).
- **`emit('unsupported')` is live** — it is **dead code**; the `events.ts:111-113` doc
  comment is wrong. This invalidated two reviewers' proposed ACT-1 fix.

**Also corrected:** "two comments say 'mirrors hits pruning'" → one. "Max 3 boolean
props on any component" → `RoomSection.tsx` has **5**. "`apps/web/src/lib` — ~25 helpers,
almost all tested" → 28 files / 21 tests. "`docs/planning` has 40 files" → 31.
"i18n is airtight" → self-contradicted by the same report's OVERLAY-I18N.

---

## Architecture radar (proposals — visibility, not action)

- **Retention duplicated 4×** (`search-manager.ts:1745`, `activity.service.ts:223`,
  `price-check-history.service.ts:66`, `deal-history.service.ts:75`), two SQL idioms →
  reaches the 3+ threshold; a declarative retention manifest + one `RetentionService` is a
  legitimate **S4 proposal**. _But the "cadence should be config" rationale is refuted_ —
  cadence is an amortization detail with no operator-meaningful semantics, and the
  cadences _should_ differ (activity rows carry full item+steps JSON; hits are small).
- **God files** — `search-manager.ts` **2082** (was 1972 at the 2026-07-10 review: **+110**),
  `SearchesPage.tsx` **1362**, `deal-watch.service.ts` **1033**, `SettingsPage.tsx` **789**.
  This is **ARCH-1 still open**, not a new finding; the new datum is the growth signal.
  `i18n/messages.ts` (1382) is correctly **exempt** — a flat `as const` table has one
  responsibility. Recommendation stands: **park `SearchManager`** (detection hot path,
  plan 43/44 just landed), **do `SearchesPage`/`AddSearchForm`**.
- **`setDealRowCleanup` single-slot** — **refuted**: `search-manager.ts:605-611`
  explicitly documents "A callback slot, not an event — exactly one consumer owns deal
  cleanup" (plan 41, review F2). One consumer. A registry now is premature.
- **`HTTP_FETCH` in `trade-api.client.ts`** — 2 consumers → below threshold → "leave it"
  is the **correct** call; the 3rd triggers a move.

---

## Pre-commit gates (not review findings — required before any commit)

1. **`pnpm format`** — `format:check` is RED on 5 files (both new source files +
   `CLAUDE.md`, `30_open_questions.md`, `40_decisions.md`). The pre-push hook hard-fails.
2. **`pnpm verify`** must be re-run green after the fixes.
3. Stage **explicit full paths**, one logical group at a time; verify
   `git show --stat HEAD` after. No `Co-Authored-By`.

---

## Accepted / deferred (owner: Bartosz — solo dev)

| Item                                                                              | Rationale                                                                                                                                       | Trigger                                                                          |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **O-12** Buy-automation ToS exposure                                              | Recorded open, "needs a decision, not a default"                                                                                                | **Before the first tag** — governs FAQ-1's text; do not rewrite the README first |
| **O-13** plaintext-fallback policy                                                | Recorded open; ENC-1 + the DB-mode S4 fold into it                                                                                              | **Before the first tag**                                                         |
| Code signing / notarization (`"identity": null`)                                  | D-18 called a Developer ID a hard release prerequisite                                                                                          | Before the first tag                                                             |
| No crash reporting                                                                | Known; LOG-1 is the "alive but wrong" half                                                                                                      | Before the first tag                                                             |
| CI Ubuntu-only → native paths never run on their target OS                        | Known                                                                                                                                           | Before the first tag                                                             |
| macOS natives unvalidated on hardware (O-6/O-7/O-8, CV thresholds `TODO(verify)`) | Known hardware gap                                                                                                                              | Before the first tag                                                             |
| **card-bridge named in ~15 public-doc locations**                                 | **NDA question only Bartosz can answer.** If that engagement is NDA-covered this is **S1 confidentiality**, not S4 — the repo is already PUBLIC | **Decide now**                                                                   |

---

## Recommendation

Land the fixes in the order below (FIX-1..FIX-8 clear the gate). Then re-run
`pnpm format` + `pnpm verify`, and re-review the affected agents against the new diff,
updating **this** record rather than opening a new one.

Two items deserve a decision independent of the gate: the **card-bridge/NDA** question,
and **NOTES-1** (`docs/notes-from-memory.md` is live at a public URL today) — delete it
regardless of the gate.

And correct the **`foreign_keys` memory** in the same commit as FIX-1. A wrong invariant
in memory propagates into every future review and every future delete path — it already
caused one review to dismiss a live S1 as inert.
</content>
</invoke>
