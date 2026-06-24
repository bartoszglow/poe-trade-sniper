---
type: plan
status: proposed
tags: [poe2, sniper, capture, automation, permissions]
created: 2026-06-24
---

> **Resolved user decisions (2026-06-24):**
>
> - **#1 = A** — defer macOS code-signing: ship Phase 1 behind a **dev-flag**; a real **Developer ID + stable Team ID + invariant appId** is a hard prerequisite before any end-user release (TCC grants reset on identity change).
> - **#2 = B (refuse)** — the per-search **Buy** toggle **cannot be enabled without** the required macOS permission. The UI **disables** the toggle (with a "grant Screen Recording + Accessibility" message) and the **server refuses** `autoBuy=true` — `assertAutoBuyAllowed` checks the capability gate (`canControl`) **in addition to** `autoTravel`. The runtime gate still enforces structurally; on later revocation the displayed toggle reflects disabled and the action is skipped (the persisted intent flag is preserved; re-grant restores). This **supersedes any "advisory" wording in the body below** (§4.5 edited accordingly).

# poe-trade-sniper — Design & Implementation Plan

## Phase 1 (macOS permissions + gating) · Phase 2 (per-search Buy automation)

DESIGN ONLY. No code below. Every file/token/signature is grounded in the current tree and incorporates the review's corrections — the two S2 blockers are resolved in the design (not parked), and all S3/S4 fixes are folded in.

---

## 1. Overview & decisions

**The two features**

- **Phase 1 — macOS permissions (Option A semantics):** In Settings, on macOS only, two toggles — Screen Recording + Accessibility. Each toggle is a **mirror + launcher**, never a writable setting: it reflects the _live OS TCC status_; tapping when not-granted prompts / deep-links to the correct System Settings pane; the app can **never** revoke (the user does that in System Settings); revocation is **detected by polling** and **gates** (refuses) any dependent action. Windows/web need no toggles. **The gating framework ships now; the gated actions ship in Phase 2.**
- **Phase 2 — per-search Buy automation (Electron-only):** A per-search **Buy** toggle, enabled only when that search's **Travel** toggle is on (else a message tells the user to enable Travel first). On a Buy+Travel hit where auto-travel **succeeds**: focus the game window → fast screen-capture until the trade/merchant window is detected → locate the item → **human-like mouse MOVE onto it. NO click** (a later iteration). Web build shows the toggle disabled with an explanation.

**Locked decisions (record in `docs/planning/40_decisions.md`)**

1. **Ports in `apps/server`, native adapters in `apps/desktop`.** All native code (`nut.js`, `uiohook-napi`, `opencv-wasm`, Electron `desktopCapturer`/`systemPreferences`) lives **only** in `apps/desktop`. `apps/server` depends solely on port interfaces + a no-op default. (Rejected: `await import('nut.js')` in server — esbuild still resolves/links it.)
2. **Deterministic registration BEFORE `app.listen()` (resolves S2-#1).** `startServer()` gains an optional `platformFactory?: () => DesktopPlatform`. The desktop builds the bridge at `app.whenReady()` and passes it in, so the **real adapters are in the DI container before any `onApplicationBootstrap` runs**. No post-boot mutable swap, no startup race, no silently-dropped early hits. Web/CLI/test pass nothing → no-op default.
3. **Capability gate is structurally unavoidable (resolves S3 gate gap).** The capability check lives **inside the desktop port adapters** (each adapter throws `PermissionDeniedError` when its grant is missing), at the resource boundary. The orchestrator's pre-check is an optimization, not the sole guard. A future click iteration cannot bypass it.
4. **Single permission-state predicate.** One `isGrant(state)` (`'granted'` only) + one `describeState(state)` shared by the gate AND the UI — no divergence. `'restricted'` (MDM) → treated as denied, but surfaced with a distinct "managed by your organization" message.
5. **Buy trigger reuses the existing `TravelEvent{phase:'success', source:'auto'}`** on the `RealtimeBus`. `travel.service.ts` is **not edited** — pure pub/sub coupling.
6. **`autoBuy` mirrors `autoTravel`** through every layer (shared type → DB column → manager validation → controller schema → web hook → UI toggle). Buy-without-Travel is rejected server-side; because auto-travel already requires `securable`, auto-buy only ever fires on Instant-Buyout hits — GGG rules untouched.
7. **`BuyAutomationEvent{type:'buy'}` is compiler-enforced (resolves S3 OCP gap).** Add `assertNever` to the web SSE reducer so a new union member fails typecheck until handled; the `case 'buy'` + its i18n keys ship in Phase 2.
8. **Buy ends at mouse-MOVE.** `InputController` has **no `click`** method by design until the verify-then-act click iteration.
9. **Stable macOS code signing is a hard precondition (resolves S2-#2).** `apps/desktop/package.json` currently has `mac.identity: null` → unsigned → **TCC grants reset every update**. Phase 1 ships to end users **only** behind a real Developer ID identity + stable Team ID + invariant `appId`. Until signed, the permission toggles ship **behind a dev-only flag**. Verified with `codesign -dv` across two builds.
10. **One source of permission truth = HTTP.** Permission status + capability flags fold into the **existing `StatusController`** poll (one cadence, one endpoint, server-owned `PERMISSIONS_POLL_MS`). No second client-only interval constant. IPC is used only for the two acts HTTP can't do (prompt, open pane), and `permissions:request` is **fire-and-forget** (`send`, not `invoke`) so the IPC return value is never a second truth source.

**Platform matrix**

|                 | Screen-Recording / Accessibility toggles    | Buy automation                                                                                   |
| --------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| macOS desktop   | shown, live TCC status, Option A            | runs (gated)                                                                                     |
| Windows desktop | not shown ("not required on this platform") | toggle shown **disabled — "unsupported on Windows"** (UIPI/elevation), distinct from web message |
| Web             | not shown                                   | toggle shown **disabled — "browser can't capture/control"**                                      |

---

## 2. Architecture

### 2.1 Layout (where each piece lives)

```
packages/shared/src/
  permissions.ts   PermissionKind, PermissionState, PermissionsStatus,
                   isGrant(), describeState(), DesktopPermissionsApi,
                   PERMISSION_KINDS (const tuple — renderer+main can't drift)
  search.ts        + autoBuy: boolean on ManagedSearch (→ SearchRuntimeInfo)
  events.ts        + BuyAutomationEvent in the DomainEvent union
  index.ts         re-export permissions.ts

apps/server/src/                          (cross-platform — NEVER imports a native addon)
  platform/
    platform.tokens.ts   CAPTURE_SOURCE, INPUT_CONTROLLER, TRADE_VISION,
                         PERMISSION_PROBE, USER_INPUT_WATCHER  (Symbols)
    ports.ts             port interfaces + DesktopPlatform aggregate
    noop-platform.ts     safe no-op adapters (default; used by web/CLI/dev/test)
    platform.module.ts   provides each token via useFactory → from injected
                         DesktopPlatform (real or no-op); exports them
  permissions/
    capability.ts             CapabilityKind = 'capture' | 'control'; REQUIRED table
    permissions.service.ts    status() → PermissionsStatus
    permission-gate.service.ts canCapture()/canControl()/assert(capability)
    permission-denied.error.ts PermissionDeniedError (capability + missing kinds)
    permissions.module.ts
  buy-automation/                          (orchestrator only — no native deps)
    buy-automation.service.ts  RealtimeBus subscriber + pipeline orchestration
    buy-automation.module.ts
  app.module.ts        + PlatformModule, PermissionsModule, BuyAutomationModule
  api/
    api.module.ts      + PermissionsModule import (controller for status)
    status.controller.ts  StatusResponse += { permissions, capabilities, buyAutomation }
  server.ts            startServer(opts?: { platformFactory?: () => DesktopPlatform })
  config/env.ts        + PERMISSIONS_POLL_MS, BUY_CAPTURE_POLL_MS,
                       BUY_CAPTURE_TIMEOUT_MS, BUY_SYNTHETIC_INPUT_GRACE_MS,
                       BUY_FOCUS_VERIFY_MS  (all Zod, defaults, no magic numbers)
  db/schema.ts         searches += auto_buy
  db/migrations/0004_search_auto_buy.sql

apps/desktop/src/                          (the ONLY home of native code)
  platform/
    permission-probe.electron.ts   systemPreferences (darwin guard)
    capture-source.electron.ts     desktopCapturer + focus/verify; gate-checks
    trade-vision.adapter.ts        main-thread facade → worker
    trade-vision.worker.ts         worker_thread: OpenCV-wasm match
    input-controller.nut.ts        nut.js move (AbortSignal steps); gate-checks
    user-input-watcher.uiohook.ts  uiohook-napi global listener
    build-desktop-platform.ts      assembles DesktopPlatform aggregate
  ipc/permissions.ipc.ts           ipcMain handlers (validated kind)
  main.ts                          startServer({ platformFactory }) + IPC wiring
  preload.cjs                      contextBridge: desktopPermissions, systemInfo
  package.json                     nut.js / uiohook-napi / opencv-wasm HERE only

apps/web/src/
  hooks/useServerStatus (existing)  reads permissions + capabilities from status
  pages/SettingsPage.tsx            PermissionsCard (darwin+desktop only)
  pages/SearchesPage.tsx            resolves Buy control once; passes into SearchRow
  hooks/useSearches.ts              + autoBuy on Add/Update payloads
  hooks/EventStreamProvider.tsx     reduceEvent += case 'buy' + assertNever default
  i18n/messages.ts                  EN(as const) + PL parity (both at once)
```

### 2.2 Ports & SOLID seams (explicit)

```
ports.ts  (apps/server — no electron import)
  PermissionProbe   query(kind): PermissionState
                    request(kind): Promise<void>          // prompt / open pane
                    openSettingsPane(kind): void
  CaptureSource     capture(): Promise<RawFrame>          // adapter gate-checks 'capture'
                    focusGameWindow(): Promise<boolean>
                    isGameWindowFocused(): Promise<boolean>
  TradeVision       detectTradeWindow(frame): Promise<WindowRegion | null>
                    locateItem(frame, region, target): Promise<Point | null>
  InputController   moveHumanLike(to, signal): Promise<void>   // adapter gate-checks 'control'
                    /* NO click in Phase 2 */
  UserInputWatcher  onRealInput(cb): () => void            // uiohook abort source
  DesktopPlatform   { permissionProbe, captureSource, tradeVision,
                      inputController, userInputWatcher }  // the aggregate
```

- **DIP** — `PermissionsService`, `PermissionGateService`, `BuyAutomationService` depend on ports, never on Electron/nut.js.
- **OCP** — capability→permission is a **table** (`Record<CapabilityKind, PermissionKind[]>`); new `DomainEvent` members are exhaustiveness-checked; adding a platform = a new adapter, zero server change.
- **SRP** — orchestrator vs capture vs vision vs input vs watcher are each one job.
- **Composition over flags** — `CapabilityKind` (not booleans); the Buy control is a three-state resolver, not nested ternaries.
- **Gate at the boundary** — adapters self-check (decision #3), so the gate is a guarantee, not a convention.

### 2.3 End-to-end flow

```
PHASE 1 — status / gate (single source = HTTP status poll):
  renderer useServerStatus ──GET /api/status──▶ StatusController
        ▲ poll @ PERMISSIONS_POLL_MS (detects revocation)   ├▶ PermissionsService ▶ PERMISSION_PROBE
        │  (one cadence, one endpoint)                       │     darwin: Electron systemPreferences
        │                                                    │     web/win/dev: no-op → 'unsupported'
        │                                                    └▶ PermissionGateService → capabilities{canCapture,canControl}
  toggle tap, not granted ──IPC send 'permissions:request'──▶ main ▶ probe.request()  [then renderer re-reads status]
  toggle tap, granted      ──IPC send 'permissions:open-pane'─▶ main ▶ shell.openExternal(x-apple.systempreferences:…)

PHASE 2 — buy pipeline (zero edit to travel.service.ts):
  GGG hit ▶ SearchManager.recordHits ▶ RealtimeBus 'hit'
        ▶ TravelService.maybeAutoTravel (autoTravel + securable) ▶ enqueue ▶ processQueue
        ▶ tradeApi.travel() OK ▶ rememberTraveled ▶ RealtimeBus 'travel'{success,auto} ▶ gameFocus.focus()
                                                              │
        BuyAutomationService (bus subscriber) ◀──────────────┘   (async; never awaited in processQueue)
          filter: success & auto & searchId≠null & isAutoBuyEnabled(searchId) & gate.canControl()
          ▶ gate.assert('control')                       (live re-check; revocation aborts)
          ▶ CaptureSource.focusGameWindow + isGameWindowFocused  (Wine can no-op → fail observable)
          ▶ capture loop (BUY_CAPTURE_POLL_MS / _TIMEOUT_MS) ▶ TradeVision.detectTradeWindow (worker_thread, OpenCV-wasm)
          ▶ TradeVision.locateItem ▶ VERIFY-THEN-ACT (fresh capture+locate)
          ▶ InputController.moveHumanLike(point, abortSignal)   ── STOP (no click)
          ▶ throughout: UserInputWatcher.onRealInput → controller.abort()
          ▶ finally: tear down watcher + abort controller
          ▶ RealtimeBus 'buy'{phase} ▶ SSE ▶ renderer toast/row status (reduceEvent case 'buy')
```

GGG hard rules untouched: the only GGG call is the existing `tradeApi.travel()` through the governor; buy reads the **game window** via `desktopCapturer`, never the trade API. No new outbound GGG traffic; no credential ever reaches native code.

---

## 3. Phase 1 design — macOS permissions

### 3.1 `PermissionProbe` adapter (`apps/desktop/.../permission-probe.electron.ts`)

- Hard `process.platform === 'darwin'` guard → else `'unsupported'`.
- **Screen Recording** → `systemPreferences.getMediaAccessStatus('screen')` (`granted/denied/restricted/not-determined`, 1:1 with `PermissionState`). Electron has no programmatic prompt for screen recording, so `request('screenRecording')` calls `openSettingsPane`.
- **Accessibility** → `systemPreferences.isTrustedAccessibilityClient(false)` for `query` (pure read); `request('accessibility')` calls it with `prompt=true` then deep-links.
- **`openSettingsPane`** → `shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture' | '?Privacy_Accessibility')`. Record the exact pane URLs + tested macOS version in `docs/integration/` (`TODO(verify)`; same evidence discipline as GGG, applied to the OS).
- `query` is pure/non-blocking → cheap to poll for Option A revocation detection. No main-process timer; the status poll drives cadence.

### 3.2 `PermissionsService` + `PermissionGateService` (`apps/server/src/permissions/`)

- `PermissionsService` ctor: `@Inject(APP_CONFIG)`, `@Inject(PERMISSION_PROBE)`. `status()` → `PermissionsStatus`. **No revoke method exists** (Option A). Explicit `@Inject` on every param (tsx emits no metadata — hard rule).
- `capability.ts`: `REQUIRED: Record<CapabilityKind, PermissionKind[]>` = `{ capture:['screenRecording'], control:['screenRecording','accessibility'] }`.
- `PermissionGateService` ctor: `@Inject(PermissionsService)`. `canCapture()/canControl()` = `REQUIRED[cap].every(kind => isGrant(probe.query(kind)))` using the **shared `isGrant`** (decision #4). `assert(cap)` throws `PermissionDeniedError` carrying the capability + the missing kinds. On non-darwin the probe returns `'unsupported'` → `isGrant` false → `canControl()` false → `assert` throws. Same predicate powers the UI badge/disabled state.
- `PermissionsModule` imports `ConfigModule` + `PlatformModule`; provides + exports `PermissionsService`, `PermissionGateService`. Added to `app.module.ts` and `api.module.ts`.

### 3.3 IPC / preload contract (the only IPC in the app)

`preload.cjs` (still sandboxed, contextIsolation on; currently 6 lines — clean slate):

```js
const { contextBridge, ipcRenderer } = require('electron');
window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.dataset.shell = 'desktop';
});
contextBridge.exposeInMainWorld('desktopPermissions', {
  requestPermission: (kind) => ipcRenderer.send('permissions:request', kind), // fire-and-forget (S3 fix)
  openSettingsPane: (kind) => ipcRenderer.send('permissions:open-pane', kind),
});
contextBridge.exposeInMainWorld('systemInfo', { platform: process.platform }); // solves deprecated navigator.platform
```

- Narrow typed surface only — never raw `ipcRenderer`, never `require` exposed.
- **`permissions:request` is `send`, not `invoke`** (review S3): status truth flows only over HTTP; renderer re-reads `/api/status` after firing.
- Main (`ipc/permissions.ipc.ts`): `ipcMain.on('permissions:request' | 'permissions:open-pane', …)`, validating `kind` against the shared `PERMISSION_KINDS` tuple from `packages/shared` (renderer + main can't drift). Registered once in `main.ts`.

### 3.4 Status extension (single source of truth — decision #10)

`StatusResponse` gains `permissions: PermissionsStatus` and `capabilities: { canCapture: boolean; canControl: boolean }` (`StatusController` injects `PermissionsService` + `PermissionGateService`). The existing status poll already runs; no new endpoint, no second cadence. A dedicated `GET /api/permissions` is optional and **not** added (avoids a duplicated client interval the conventions forbid).

### 3.5 Settings UI + i18n + capability gate (Option A)

- New `PermissionsCard` in `SettingsPage` (reusing the local `SettingsCard`), rendered **only** when `window.systemInfo?.platform === 'darwin'` AND `data-shell === 'desktop'` **AND** the dev-flag/signed-build condition (decision #9). On Windows desktop: one muted line `settings.permissions.notRequired`. On web: nothing.
- Permission status comes from `useServerStatus` (no new hook with its own interval). A thin `usePermissions()` may wrap it for ergonomics but **must not** add a second poll; revocation detection is the status poll seeing the live OS state flip.
- Each toggle (reusing `Switch`): `checked = isGrant(state)`, `tone = isGrant ? 'gold' : 'info'`. **Option A handler:**
  - not granted → `window.desktopPermissions?.requestPermission?.(kind)` (feature-detected, no-ops on web — S3 fix) then prompt/deep-link; never flips optimistically.
  - granted → `openSettingsPane(kind)` ("manage in System Settings") — the app **cannot revoke**.
  - The visible flip happens **only** on the next status poll reading live TCC. The toggle is a mirror + launcher.
- A `Badge` shows the live state via shared `describeState`: `ok` granted / `danger` denied / `neutral` not-determined / a distinct `restricted` ("managed by your organization") message (S3 fix — no pointing MDM users at a pane they can't change). `label` on `Switch` is aria-only; visible label sits in the same `<span>`.
- i18n (EN `as const` + PL parity, added together or build breaks): `settings.permissions.title`, `.notRequired`, `.screenRecording(+Desc)`, `.accessibility(+Desc)`, `.granted`, `.denied`, `.notDetermined`, `.restricted`, `.manage`.

---

## 4. Phase 2 design — Buy automation

### 4.1 Server `autoBuy` flag (cross-platform, no native deps)

1. `packages/shared/src/search.ts` → `autoBuy: boolean` on `ManagedSearch` (flows to `SearchRuntimeInfo`).
2. DB: `0004_search_auto_buy.sql` → `ALTER TABLE searches ADD COLUMN auto_buy integer NOT NULL DEFAULT 0;`; `db/schema.ts` → `autoBuy: integer('auto_buy',{mode:'boolean'}).notNull().default(false)`; regenerate drizzle meta via the project script (don't hand-edit meta). Applies at boot (`migrate.ts`).
3. `search-manager.ts`: add `autoBuy?` to `AddSearchOptions`/`UpdateSearchOptions`; map in `rowToManagedSearch`; persist in `add()`/`update()`; new `assertAutoBuyAllowed(autoBuy, autoTravel, gate)` — rejects when `autoBuy && !autoTravel` (`BadRequestException('auto-buy requires auto-travel to be enabled')`) **and (decision #2 = B) when `autoBuy && !gate.canControl()`** (`BadRequestException('grant Screen Recording + Accessibility to enable auto-buy')`); called after `assertAutoTravelAllowed` in both. `SearchManager` injects `PermissionGateService` (`@Inject`). new `isAutoBuyEnabled(searchId)` mirroring `isAutoTravelEnabled`. `toRuntimeInfo` spreads `...row` → `autoBuy` surfaces automatically.
4. `searches.controller.ts`: `autoBuy: z.boolean().optional()` in `addSearchSchema` + `updateSearchSchema`; add to the `.refine` "nothing to update" guard; pass through in `add()`/`update()`.
5. `useSearches.ts`: `autoBuy?: boolean` on `AddSearchPayload` + `UpdateSearchPayload`.

### 4.2 Trigger + orchestrator

- `BuyAutomationService` (`apps/server/src/buy-automation/`) ctor — explicit `@Inject` each: `APP_CONFIG`, `RealtimeBus`, `SearchManager`, `PermissionGateService`, plus the ports (`CAPTURE_SOURCE`, `TRADE_VISION`, `INPUT_CONTROLLER`, `USER_INPUT_WATCHER`). Implements `OnApplicationBootstrap`/`OnApplicationShutdown` to subscribe/unsubscribe (cleanup invariant).
- Subscriber filter (mirrors `maybeAutoTravel`): `phase==='success' && source==='auto' && searchId!==null && searchManager.isAutoBuyEnabled(searchId) && gate.canControl()`. Because adapters are registered **before `app.listen()`** (decision #2), `gate.canControl()` is already truthful at the first event — no startup race, no silent drop.
- Fires **async, off the bus** — never awaited inside `processQueue` (must not block the sequential travel queue). `travel.service.ts` is unaware buy exists. Dedupe is inherited: travel only publishes `success` post-`rememberTraveled`, and deduped listings never enter the queue → one `success` per listing.

### 4.3 Pipeline (honors the safety design)

`run(searchId, listingId, itemName)`:

1. `gate.assert('control')` — live re-check; revocation since toggle-on → publish `buy{phase:'failed', detail:'permission revoked'}` and return.
2. `AbortController`; subscribe `UserInputWatcher.onRealInput(() => abort())`. Synthetic-vs-real disambiguation lives **in the adapter**: timestamp the last `moveHumanLike` step and ignore uiohook events within `BUY_SYNTHETIC_INPUT_GRACE_MS` (env tunable, not inline — S4 fix); prefer positive coordinate/timestamp correlation if the dev-Mac probe shows uiohook fires for synthetic moves.
3. Focus + **verify** (`focusGameWindow` then `isGameWindowFocused`) — `activate` can silently no-op under Wine; if focus didn't land → `buy{phase:'failed', detail:'focus-failed'}`.
4. Capture loop: `capture()` → `detectTradeWindow`; per-iteration `AbortSignal` timeout (`BUY_CAPTURE_POLL_MS` ~100ms / `BUY_CAPTURE_TIMEOUT_MS` ~5s — all config). Adapter caches the located window source; re-enumerates only on detect miss (`desktopCapturer.getSources()` is expensive).
5. `locateItem` in the detected region — OpenCV-wasm in a **worker_thread** (keeps the Nest event loop/SSE responsive).
6. **Verify-then-act in the same tick** — fresh capture+locate re-confirms the target before moving.
7. `moveHumanLike(point, signal)` — small awaited steps with jitter; each checks `signal.aborted`. **STOP. No click.**
8. `finally` — tear down the watcher subscription + abort controller.

Coordinate space: `desktopCapturer` and `nut.js` are screen-space but HiDPI/multi-display scaling differs — desktop adapters own a single `toScreenPoint()` (logical↔physical via matched display `scaleFactor`); the orchestrator deals only in abstract `Point`s. `TODO(verify)` on dev Mac.

**Gate at the boundary (decision #3):** `CaptureSource.capture()` and `InputController.moveHumanLike()` adapters each consult the gate and throw `PermissionDeniedError` when their grant is missing. The orchestrator's `assert('control')` is an optimization; the resource boundary is the real guard, so the future click iteration cannot bypass it.

### 4.4 Buy status to the UI (compiler-enforced — decision #7)

- `BuyAutomationEvent { type:'buy'; phase:'started'|'window-found'|'item-located'|'moved'|'aborted'|'failed'|'unsupported'; searchId; listingId; itemName; detail; at }` added to the `DomainEvent` union in `events.ts`.
- `EventStreamProvider.reduceEvent` gains a `case 'buy'` **and** an `assertNever(event)` default so the union is exhaustiveness-checked at compile time (the OCP claim becomes a real invariant). Toast strings via `translateStatic`; SSE-handler i18n keys added in this phase.
- `StatusResponse.buyAutomation = { lastResult, supported }` where `supported = capabilities.canControl` — reuses Phase-1 capability flags so the UI knows whether to offer the feature.

### 4.5 Web/Windows degradation + the Buy toggle (composition; dumb row)

- `SearchesPage` resolves capability + platform **once** and passes the resolved Buy control state into `SearchRow` as a prop (S4 fix — `SearchRow` stays presentational, doesn't read `window.*` or global status). `SearchRow.onUpdate` widens to `{ autoTravel?; enabled?; label?; autoBuy? }`.
- Three mutually-exclusive states (extracted resolver, not inline ternaries):
  1. **Web** (`platform!=='darwin'` or `data-shell!=='desktop'` and not Windows-desktop): disabled `Switch` + `searches.buyWebOnly(+Desc)` — "a browser can't capture/control".
  2. **Windows desktop**: disabled `Switch` + distinct `searches.buyUnsupportedOs(+Desc)` — "unsupported on Windows" (UIPI/elevation). Distinct from the web message (review open-question #6).
  3. **macOS desktop + `!autoTravel`**: gating message `searches.buyRequiresTravel` instead of a dead switch.
  4. **macOS desktop + `autoTravel` on + `canControl`**: live `Switch` (`tone='gold'`, `onChange → PATCH /api/searches/:id { autoBuy }`).
  5. **macOS desktop + `autoTravel` on + `!canControl`** (permission missing or later revoked): **disabled `Switch`** + `searches.buyNeedsPermission` message linking to the permission settings. **DECISION #2 = B (refuse):** Buy cannot be enabled without the permission — the server also refuses (`assertAutoBuyAllowed` requires `canControl`, §4.1), and the displayed `checked` = `autoBuy && canControl`, so a revoked permission shows the toggle **off + disabled** (the persisted `autoBuy` intent is preserved and restored on re-grant). The runtime gate in the adapters remains the structural enforcement.
- The toggle only ever PATCHes `{ autoBuy }`. **No native import reaches the web bundle** — all capture/input lives in `apps/desktop` behind ports the web never imports.
- i18n: every key in EN (`as const`) + PL together.

---

## 5. Implementation plan (ordered, file-by-file)

Each step: `pnpm verify` green before commit; explicit-path staging; verify `git show --stat HEAD`; no `Co-Authored-By`. Tests assert **intent + failure paths**.

### Phase 0 — de-risk spike (do first; not user-facing; throwaway/dev-flagged)

**P0.1 — Wine/capture/input capture spike (`apps/desktop`, scratch).** Prove on the dev Mac (Screen Recording + Accessibility already granted): (a) `desktopCapturer.getSources({types:['window']})` finds the PoE2 Wine window + its title regex; (b) coordinate mapping `desktopCapturer` frame ↔ `nut.js` screen-space across the HiDPI display; (c) **does `uiohook-napi` fire for synthetic `nut.js` moves?** (drives the abort disambiguation); (d) `systemPreferences.getMediaAccessStatus('screen')` + `isTrustedAccessibilityClient(false)` read live and flip when toggled in System Settings; (e) `activate` reliability under Wine (does focus actually land?). **Output:** findings recorded in `docs/integration/` with date+evidence; a recorded screenshot **fixture** of the trade window (no live GGG) for OpenCV strategy. No commit of spike code; results inform the ports.
**P0.2 — Signing decision.** Confirm Developer ID identity + Team ID now (so TCC persists) OR confirm Phase 1 ships behind a dev flag. Record in `40_decisions.md`. Verify `codesign -dv` authority stable across two builds. Blocks "Phase 1 to users".

### Phase 1 — permissions + gating framework (build now)

**1.1 Shared types** — `packages/shared/src/permissions.ts` (`PermissionKind`, `PermissionState`, `PermissionsStatus`, `isGrant`, `describeState`, `PERMISSION_KINDS`, `DesktopPermissionsApi`) + `index.ts` re-export. _Tests:_ `isGrant` only true for `'granted'`; `describeState` covers all five states. _Docs:_ none.
**1.2 Platform ports + no-op + module** — `apps/server/src/platform/{platform.tokens,ports,noop-platform,platform.module}.ts`. _Tests:_ no-op `PermissionProbe.query` → `'unsupported'`; aggregate wiring resolves tokens. _Docs:_ `40_decisions.md` decision #1.
**1.3 `startServer({ platformFactory? })`** — `apps/server/src/server.ts`: accept optional factory, build `DesktopPlatform` (or no-op) and provide it **before `app.listen()`**. _Tests:_ boot with no factory → no-op tokens in container; boot with a fake factory → fake tokens, and a fake bus event after bootstrap is handled (proves no startup race). _Docs:_ `40_decisions.md` decision #2 + the boot-contract note.
**1.4 PermissionsService + gate + error** — `apps/server/src/permissions/*`. Explicit `@Inject`. Capability→permission **table**. _Tests:_ gate `canControl` false when probe denies either kind; `assert('control')` throws `PermissionDeniedError` with the missing kinds; `'restricted'` treated as denied. _Docs:_ decisions #3, #4.
**1.5 Status extension** — `status.controller.ts` + `StatusResponse` += `permissions`, `capabilities`. _Tests:_ status returns `'unsupported'` + `canControl:false` under no-op platform. _Docs:_ decision #10.
**1.6 Server wiring** — `app.module.ts` (+ `PlatformModule`, `PermissionsModule`), `api.module.ts` (+ `PermissionsModule`), `env.ts` (+ `PERMISSIONS_POLL_MS`). _Tests:_ app compiles + boots; config defaults validate.
**1.7 Desktop probe adapter + IPC + preload** — `apps/desktop/src/platform/permission-probe.electron.ts`, `ipc/permissions.ipc.ts`, `preload.cjs`, `main.ts` (pass `platformFactory`, register IPC after build). `kind` validated against shared `PERMISSION_KINDS`; `permissions:request` is `send`. _Tests:_ IPC handler rejects an unknown `kind`; darwin guard → `'unsupported'` off-darwin. _Docs:_ `docs/integration/` pane URLs + macOS version (from P0.1).
**1.8 Settings UI + i18n** — `SettingsPage.tsx` `PermissionsCard` (darwin+desktop+signed/dev-flag gate), reads status; feature-detected `window.desktopPermissions?.…`; shared `isGrant`/`describeState`; `messages.ts` EN+PL keys. _Tests:_ renders nothing on web/Windows; Option-A handler never optimistically flips (granted → opens pane only). _Docs:_ `docs/architecture/frontend.md` permission-card note; `40_decisions.md` decision #9.

### Phase 2 — Buy automation (later)

**2.1 `autoBuy` shared + DB + manager** — `shared/search.ts`, `db/schema.ts`, `0004_search_auto_buy.sql` (+ regen meta), `search-manager.ts` (add/update/`assertAutoBuyAllowed`/`isAutoBuyEnabled`/runtime info). _Tests:_ `autoBuy && !autoTravel` → `BadRequestException`; persistence round-trips; `isAutoBuyEnabled` reflects the row. _Docs:_ decision #6.
**2.2 Controller + web hook** — `searches.controller.ts` schemas + refine + pass-through; `useSearches.ts` payloads. _Tests:_ PATCH `{autoBuy:true}` on a non-travel search → 400; valid PATCH persists.
**2.3 Buy event + SSE exhaustiveness** — `events.ts` (`BuyAutomationEvent`), `EventStreamProvider.tsx` (`case 'buy'` + `assertNever`), `messages.ts` SSE keys. _Tests:_ reducer handles `'buy'`; removing the case fails typecheck (assertNever guard). _Docs:_ decision #7.
**2.4 Phase-2 ports + tunables** — extend `ports.ts` (`CaptureSource`, `TradeVision`, `InputController`, `UserInputWatcher`) + no-op; `env.ts` (`BUY_CAPTURE_POLL_MS`, `BUY_CAPTURE_TIMEOUT_MS`, `BUY_SYNTHETIC_INPUT_GRACE_MS`, `BUY_FOCUS_VERIFY_MS`). _Tests:_ no-op input/capture/vision are inert; config defaults validate.
**2.5 BuyAutomationService orchestrator** — `buy-automation/*`, added to `app.module.ts`. Explicit `@Inject`. Subscriber filter + pipeline (focus-verify → capture loop → locate → verify-then-act → move → finally cleanup). _Tests (intent + failure):_ fires only on `success&auto&autoBuy&canControl`; `searchId:null` ignored; `gate.assert` failure → `buy{failed}` not a throw; focus-fail → `buy{failed,focus-failed}`; abort on `onRealInput` mid-move; **never awaited in `processQueue`** (travel queue unblocked). _Docs:_ decisions #5, #8.
**2.6 Desktop native adapters** — `apps/desktop/src/platform/{capture-source.electron,trade-vision.adapter,trade-vision.worker,input-controller.nut,user-input-watcher.uiohook}.ts` + `build-desktop-platform.ts`; native deps added to `apps/desktop/package.json` only. Adapters **self-gate** (throw `PermissionDeniedError` when grant missing). _Tests:_ each adapter refuses when probe reports `'denied'` (the structural-chokepoint guarantee); synthetic-input grace window honored. _Docs:_ `docs/integration/` coordinate-mapping + uiohook findings.
**2.7 Buy toggle UI** — `SearchesPage.tsx` resolves control once + passes to `SearchRow`; three/four-state resolver; `messages.ts` (`buyToggle`, `buyFor`, `buyRequiresTravel`, `buyWebOnly(+Desc)`, `buyUnsupportedOs(+Desc)`) EN+PL. _Tests:_ web → disabled+web message; Windows → disabled+os message; travel-off → requires-travel message; travel-on → live toggle PATCHes `{autoBuy}`. _Docs:_ `frontend.md` Buy-toggle note.

**CI guard (with 2.4):** dependency-cruiser rule (or `grep` check) asserting **no `nut.js`/`uiohook-napi`/`opencv-wasm`/`electron` import is reachable from `apps/server`** — tree-shaking is explicitly untrusted here, so make the boundary a build-time assertion. **E2E:** mock/skip Buy scenarios (native bindings unavailable in CI); never live GGG — recorded fixtures only.

**ADR/docs to touch:** `docs/planning/40_decisions.md` (decisions #1–#10), `docs/planning/30_open_questions.md` (carry the open questions below), `docs/integration/` (pane URLs, coordinate mapping, uiohook behavior — date+evidence), `docs/architecture/architecture.md` + `frontend.md` (ports/adapters seam, permission card, Buy toggle), `CLAUDE.md` state-of-build line.

---

## 6. Open questions & risks (carried from the review)

1. **Boot contract:** `startServer(platformFactory?)` adds a param used by CLI/web/test. Accepted as the deterministic, race-free choice (decision #2); confirm no CLI/test caller breaks (all pass nothing → no-op).
2. **Code signing now vs dev-flag:** are we setting a real Developer ID + Team ID immediately so TCC grants persist, or shipping Phase 1 behind a dev flag until signing lands? (Decision #9 says dev-flag until signed — **confirm.**) The feature is near-worthless to end users while `mac.identity: null`.
3. **Gate placement confirmed at the adapter boundary** (decision #3) — confirm we accept the small duplication (orchestrator pre-check + adapter self-check) in exchange for the structural guarantee.
4. **Buy-toggle UX when permissions missing:** advisory (persist `autoBuy=true`, server-side gate skips at runtime) vs refuse-PATCH. Design picks **advisory** — confirm a visibly-inert toggle is the desired UX.
5. **`uiohook-napi` for synthetic moves** (`TODO(verify)`, P0.1): grace-window + positive correlation mitigation; do not ship the move step until proven on the dev Mac (recorded in `docs/integration/`).
6. **`x-apple.systempreferences:` pane URLs** on the target macOS version (`TODO(verify)`, record with evidence + date).
7. **HiDPI/multi-display coordinate mapping** between `desktopCapturer` and `nut.js` (`TODO(verify)`, P0.1).
8. **OpenCV-wasm strategy** (template match vs HSV mask) — decide after the recorded trade-window fixture; no live GGG.
9. **Windows degradation message** is now distinct from web (decision/platform matrix) — confirm copy.

---

Plan complete. The two S2 blockers are resolved in the design itself (deterministic pre-`listen` registration; signing as a hard precondition with dev-flag fallback), and the S3/S4 fixes (gate at the adapter boundary, `assertNever` SSE exhaustiveness, single `isGrant` predicate, corrected isolation rationale + CI import guard, fire-and-forget IPC with feature-detection, status-poll as the single permission-truth source, dumb `SearchRow`, tunable grace window, distinct Windows message) are all folded in — no known violations left in.

---

## 7. Phase-1 as-built deviations (post-implementation review, 2026-06-24)

Adversarial review of the shipped Phase-1 diff (`b65165d`, `54b4474`, `1ceb746`) returned **fix-then-ship, no S1/S2**. Resolved deviations from §1–§6 above:

- **`PERMISSIONS_POLL_MS` dropped.** The separate 4 s cadence was dead config (no consumer); permission status rides the **existing 10 s `/api/status` poll** (`useServerStatus`). Decision #10 amended: the _truth_ is server-owned over HTTP (status carries `permissions`+`capabilities`); the _cadence_ is the one existing client poll (10 s). Acceptable — Phase 1 has no gated action, and the Phase-2 gate re-checks live at action time, so revocation never rides the poll for enforcement.
- **`isPermissionKind` keeps a local `KNOWN_KINDS … satisfies readonly PermissionKind[]`** rather than importing the runtime `PERMISSION_KINDS`. The review's suggested value-import would pull `@poe-sniper/server` into the **packaged main** (which loads the esbuild bundle, not the package) — it would break packaging. `satisfies` gives typo/removed-kind safety without the runtime dep.
- **Permission card gate simplified to `isMacDesktop`** (removed the `networkViewEnabled` coupling — hiding the request log shouldn't hide the card). Every current build is unsigned/dev, so "show on macOS desktop" == decision #1=A's intent for now; a real release gate + stable signing land in **Phase 5**.
- **Accessibility probe** `denied → not-determined` collapse marked `TODO(verify)` (boolean-only API; gating is unaffected since `isGrant` is false either way).
- **Windows "not required" line NOT implemented** — the card renders nothing off macOS-desktop (matches step 1.8). §3.5's `settings.permissions.notRequired` wording is **superseded**; Windows is not a Phase-1 target.

Deliberately deferred (S4, safe): IPC `senderFrame`-origin assertion (non-exploitable — `will-navigate` pinned, sandbox+contextIsolation on, both acts benign); visible-label click target (SR-correct via `aria-label`); permission-row `flex-wrap` (bounded by `minWidth: 900`).

---

## 8. Phase-2 as-built deviations (2026-06-24)

- **Buy decoupled from auto-travel (D-19).** §4.1's `assertAutoBuyAllowed(autoBuy, autoTravel)` and the "auto-buy requires auto-travel" 400 are **removed**: the gate keeps only `canControl` (decision #2=B holds). §4.2's subscriber filter drops `source === 'auto'` — `maybeBuy` now fires on **any** travel `success` (auto OR manual). Buy still acts only once the character is at the seller (a travel success), so there is no teleport/capture race, but the **toggles are independent**. §4.5's "requires-travel" state (and its `searches.buyRequiresTravel` key) are dropped from the resolver. Rationale + record: decision D-19. Decision #6's "buy-without-travel rejected" clause is superseded.

### Post-review deviations + deferrals (D-20, 2026-06-24)

- **Vision = raw-pixel, not OpenCV.** The shipped `trade-vision.adapter.ts` is a dependency-free violet selection-frame colour threshold (no `opencv-wasm`, no `trade-vision.worker.ts`). Supersedes §2.1/§4.3 + D-18's adapter list; **O-10 resolved**. The synchronous main-thread scan is accepted (stride-sampled, 5 s-bounded, opt-in); a worker offload is deferred (PERF-2/3).
- **nut.js** is `@nut-tree-fork/nut-js ^4.x` (upstream `@nut-tree/nut-js` paywalled past v4), not the plan's `>=5`; abort is implemented in the adapter, not via nut's AbortSignal.
- **`StatusResponse.buyAutomation` (§4.4) was not added** — `capabilities.canControl` covers "supported" and the SSE buy-state covers the live result; a polled `lastResult` would duplicate SSE-owned state.
- **Deferred review findings (with reason):**
  - **PERF-2/3** (cache/downscale capture + move the scan to a worker): needs on-hardware validation — it changes capture timing + coordinate mapping, only tunable against a real trade window. Bounded today (stride-sampled, 5 s timeout, opt-in).
  - **DUP-1** (shared `sanitizeProcessName` for the osascript charset): the clean fix (one helper in `packages/shared`) is infeasible for the desktop — `build-desktop-platform` runs in the packaged main, which can't runtime-import a workspace package (same constraint as the kind-list). Kept inline + cross-referenced; 2 validated enforcement points.
  - **PERF-5** (keyset pagination), **PERF-8** (lighter `/api/searches` shape), **SSE-1** (network-event coalesce): bounded for a single-operator local tool (≤10k-row table, `latestRequestId` guard, rate-governed cadence).
  - **DUP-3/4** (osascript-predicate unify, abortable-delay extract): the two focus predicates are intentionally different + delegating breaks the dev server; the delay helper is only 2 copies (below the radar threshold).
  - **TEST-5** (e2e for the auto-buy refusal) + **DOC-7** (architecture.md/frontend.md ports-seam note): the refusal is unit-tested + adapter-gated and the canonical decision survives in D-18/D-20 — low-priority follow-ups.
