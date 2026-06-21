---
type: project
status: active
tags: [poe2, sniper, trade, nestjs, react, electron, sqlite, rewrite]
created: 2026-06-11
updated: 2026-06-12
---

# PoE Trade Sniper — Master Plan (ground-up rewrite)

A from-scratch rewrite of the working prototype `~/Projects/poe2-live-sniper`,
built to **card-bridge engineering standards**. New parallel project; the old
prototype keeps running untouched until the new one supersedes it.

- **Repo (code):** `~/Projects/poe-trade-sniper` (identifier `poe-trade-sniper`, packages `@poe-sniper/*`)
- **Planning docs (this folder):** `Vault/Projects/Poe-Trade-Sniper/`
- **Reference for conventions:** `~/Projects/card-bridge/docs/` + its `CLAUDE.md`
- **Source prototype to mine for hard-won knowledge:** `~/Projects/poe2-live-sniper`

> The old prototype works and Bartosz uses it daily. **Do not touch it.** Build
> the new one alongside; cut over only when the new one is at parity + better.

---

## 1. Why rewrite, not refactor

The prototype proved the domain end-to-end (detection, browser-free travel, web
UI) but grew organically: god-ish files, ad-hoc JSON persistence, no layering, no
tests, no DI, no config validation, UI as a single 600-line HTML string. The
_knowledge_ is gold; the _code_ is throwaway. A clean rewrite on a disciplined
skeleton is faster than untangling it and yields a base we can grow (multi-search,
analytics, desktop) without it collapsing.

---

## 2. Locked stack (decided 2026-06-11)

| Layer       | Choice                                   | Rationale                                                                                                           |
| ----------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Backend     | **NestJS** (Node 22, TS)                 | modules + DI + registry pattern; runs as local server (web) or in Electron main (desktop)                           |
| Frontend    | **React 19 + Vite + Tailwind**           | atomic components, nav registry, SSE — mirrors card-bridge `apps/web`                                               |
| Desktop     | **Electron**                             | Node backend runs in-process; login via in-app `BrowserWindow`; one web→desktop codebase                            |
| Persistence | **SQLite + Drizzle** (embedded)          | file in user-data dir, zero infra, cross-platform bundling, JSON columns for item payloads; forward-only migrations |
| Repo        | **pnpm monorepo**                        | `apps/*` + `packages/shared`; Husky + lint-staged + CI                                                              |
| Tests       | **Vitest** (unit) + **Playwright** (e2e) | matches card-bridge                                                                                                 |
| Target OS   | **Windows / Linux / macOS**              | Electron + better-sqlite3 (or libsql) all cross-platform                                                            |

Deliberate **scope cuts vs card-bridge** (it is a bank; we are a single-user tool):
no RBAC/sessions/permissions, no PCI masking, **no i18n** (single operator,
English UI), no NDA/spec handling. We keep the _discipline_ (layering, registry,
config validation, atomic components, correlation logging, tests, quality gates,
docs system), not the bank-specific machinery.

---

## 3. Target repo structure

```
poe-trade-sniper/
├── apps/
│   ├── server/                 NestJS core (the sniper engine + HTTP/IPC API)
│   │   └── src/
│   │       ├── config/         Zod env schema + ConfigModule (fail-fast boot)
│   │       ├── db/             Drizzle schema + driver + migrations (forward-only)
│   │       ├── session/        PoE session: login capture, cookie/UA store, validity
│   │       ├── trade-api/      adapter: the ONLY place that talks to pathofexile.com
│   │       ├── search/         SearchManager (registry + shared-budget scheduler) + persistence
│   │       ├── engines/        detection engines registry: ws · poll (open/closed)
│   │       ├── travel/         TravelService (token POST) + lazy browser fallback
│   │       ├── ratelimit/      shared per-IP budget governor (read X-Rate-Limit headers)
│   │       ├── events/         RealtimeBus (typed pub/sub) → SSE
│   │       ├── items/          item-detail normalization (markup cleaning, typed)
│   │       └── api/            controllers: searches, events(SSE), status, health
│   ├── web/                    React operator UI (browser mode)
│   │   └── src/ (shell/ pages/ components/ lib/ hooks/)
│   └── desktop/                Electron shell (main + preload); wraps web + boots server in-process
├── packages/
│   └── shared/                 canonical domain types (Listing, ItemDetail, ManagedSearch, events)
├── e2e/                        Playwright (drives the server API against a mock PoE / recorded fixtures)
├── docs/                       how-we-build rules (mirrors card-bridge)
│   ├── architecture/           architecture.md · engines.md · travel.md · desktop.md · frontend.md
│   ├── integration/            api-notes.md (GGG API evidence log — see "no guessing" rule, §10)
│   ├── process/                conventions.md · code-review.md · reviews/
│   └── operations/             run.md (dev) · packaging.md (desktop build/sign)
├── .github/workflows/ci.yml
├── .husky/ (pre-commit, pre-push)
├── CLAUDE.md                   session manifest (hard rules + reference, like card-bridge)
├── CHANGELOG.md                Keep a Changelog
├── eslint.config.mjs · .prettierrc.json · tsconfig.base.json
└── pnpm-workspace.yaml
```

---

## 4. Backend architecture (NestJS, layered)

The open/closed core is **the engine registry** (mirrors card-bridge's operation
registry): adding a detection strategy = appending to a list, never editing the
manager.

### Modules & responsibilities

- **config/** — one Zod schema validated at boot (`env.ts`); process refuses to
  start on bad config. Profiles via `APP_ENV`. No magic numbers in code; tunables
  (poll interval floor, fetch spacing, reconnect backoff) live in config.
- **db/** — Drizzle schema + driver (better-sqlite3 / libsql). Migrations
  forward-only, applied on startup. Tables: `searches`, `hits`, `app_state`
  (session blob, settings). Item payload stored as a JSON column.
- **session/** — PoE auth as a first-class credential. Captures cookies + UA from
  a login (Electron `BrowserWindow` in desktop; system-browser/Playwright in web
  dev). Exposes `getSession()`, `isValid()` (probes `/my-account`), persists to DB
  (encrypted at rest where the OS keystore is available). **Treated as a secret:
  never logged, never returned to the UI.**
- **trade-api/** — the single adapter that talks to `pathofexile.com`. Owns the
  `X-Requested-With` + Referer + cookie header discipline (the 403 fix lives here,
  once). Methods: `resolveQuery(searchId)`, `executeSearch(query)`,
  `fetchListings(ids)`, `travel(hideoutToken)`. Every call goes through the
  rate-limit governor and is logged with a correlation id. **No `fetch` to GGG
  anywhere else.**
- **ratelimit/** — shared per-IP budget governor. Parses `X-Rate-Limit-*` response
  headers (authoritative, dynamic) instead of hardcoding; spaces requests; on 429
  pauses the shared scheduler for `Retry-After`. One governor, all callers.
- **engines/** — `DetectionEngine` interface + registry `[WsEngine, PollEngine]`.
  - `WsEngine` — `wss://…/live/…` push (near-zero latency) when GGG's live backend
    is up. Auto-reconnect with exponential backoff.
  - `PollEngine` — re-run search (newest-first) + diff ids; the fallback while GGG
    live is 504-down. Resolves query from id.
  - Engine selected per search by a boot probe (ws → fallback poll); upgrades to ws
    automatically when live returns. New engine = new class in the array.
- **search/** — `SearchManager`: registry of watched searches (DB-persisted),
  round-robin scheduler that shares the per-IP budget across N searches (one poll
  per tick, cycling). add/remove/list/setAutoTravel. Emits domain events.
- **travel/** — `TravelService`: pure-Node token POST (browser-free, the
  `X-Requested-With` win); queued one-at-a-time (a travel teleports the character);
  lazy Electron/Playwright fallback only if the API ever rejects. Per-search
  `autoTravel` flag; explicit user opt-in.
- **items/** — `normalizeItemDetail()` + `cleanMarkup()` (strip `[tag|display]`);
  typed `ItemDetail`. Pure, unit-tested.
- **events/** — typed `RealtimeBus` (`hit`, `searches`, `log`) → SSE controller.
  Same lightweight pattern as card-bridge's RealtimeBus (no manifest yet).
- **api/** — thin controllers; inbound bodies Zod-validated at the edge. In
  desktop mode the same surface is also reachable over Electron IPC (see §7).

### Cross-cutting (card-bridge parity)

- **Correlation id** threads every search→fetch→travel leg in logs.
- **Bounded growth**: `seen` id sets capped + evicted; hit history pruned/paged.
- **Cleanup**: every WS socket, timer, SSE subscription tears down on stop/disconnect.
- **Outbound timeouts**: every GGG call has an AbortController deadline.

---

## 5. Persistence (SQLite + Drizzle)

| Table       | Purpose                 | Notes                                                                                                          |
| ----------- | ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| `searches`  | watched searches        | id, realm, league, label, autoTravel, filters (JSON), addedAt                                                  |
| `hits`      | detection history       | searchId FK, listingId, itemName, price, seller, item (JSON), at — enables analytics ("what I bought / saved") |
| `app_state` | session blob + settings | single-row key/value; session encrypted via OS keystore where available                                        |

Forward-only migrations under `db/migrations`, applied on startup (web + desktop).
JSON columns hold the variable item payload (document-ish, in an embedded DB).

---

## 6. Frontend (React + Vite + Tailwind)

Mirrors card-bridge `apps/web` discipline:

- **App shell + nav registry** (open/closed): add a page = entry in `shell/nav.ts`
  - route; shell never changes.
- **Atomic components** extracted on 2nd use, variants as **enums** not booleans:
  `Badge`, `Button`, `IconButton`, `TextInput`, `Select`, `Field`; semantic on top
  (`StatusBadge`, `RarityName`, `PriceTag`).
- **SSE, not polling**: `useEventStream` opens one `EventSource`, prepends hits,
  cleans up on unmount. "● live" connection dot.
- Pages (initial): **Searches** (manage + status + per-search AUTO), **Hits**
  (live feed + expandable item-detail accordion), **Settings** (login, tunables),
  later **Analytics** (from `hits` table).
- Theming via Tailwind dark class + persisted toggle; no hardcoded hex outside the
  Badge tone map. A11y: real `<button disabled>`, keyboard paths.
- Admin/operator UI → **exempt from mockup-first** (build directly), per the global
  rule; only net-new player-facing surfaces would need a mockup.

---

## 7. Hybrid web → desktop strategy

The core principle: **one server, two shells.**

- **Web mode** (dev + browser use): NestJS boots as a standalone local HTTP server;
  React (Vite) talks to it over HTTP + SSE. Exactly today's model, cleaned up.
- **Desktop mode** (Electron): NestJS boots **in the Electron main process** (or a
  forked child); the renderer loads the same React build. UI ↔ core can go over
  loopback HTTP (simplest, reuses the web client verbatim) — IPC is an optional
  optimization later. **Login uses an Electron `BrowserWindow`** pointed at
  pathofexile.com; on success we read cookies from the window's `session` — no
  Playwright, no Cloudflare-headless fight.

To keep the desktop port cheap, the server is written shell-agnostic from day one:
no assumption of a browser, session capture behind a `SessionSource` interface
(implementations: `ElectronWindowSource`, `SystemBrowserSource`), all GGG access in
`trade-api`. The desktop app is then a thin wrapper, not a rewrite.

Packaging: `electron-builder` → NSIS (Win), AppImage/deb (Linux), dmg (macOS).
Signing/notarization deferred to a later phase (documented in `operations/packaging.md`).

---

## 8. Quality gates & tooling (card-bridge parity)

- `pnpm verify` = **lint + typecheck + test**; nothing lands red.
- **ESLint 9** flat config (+ security rules: no-eval, safe child_process),
  **Prettier** (single quotes, semicolons, 100 cols), **Vitest**, **Playwright**.
- **TypeScript strict** incl. `noUncheckedIndexedAccess`, `noImplicitAny`,
  `strictNullChecks`.
- **Husky**: pre-commit (lint-staged) + pre-push (format:check, `pnpm audit`,
  gitleaks, optional Semgrep).
- **CI** (GitHub Actions): verify + build + audit + secret-scan.
- **CHANGELOG** Keep-a-Changelog; a line per feature in the same commit.
- **Git**: explicit full paths, no `git add -A`, verify `git show --stat HEAD`,
  English messages, **no `Co-Authored-By: Claude`**, commit only when asked.
- **Decisions** → this Vault folder (`40_decisions.md`) with commit ids.

---

## 9. Safety, ToS & secrets (our version of card-bridge §security)

- **PoE session is a credential.** Cookies/UA never logged, never sent to the UI,
  encrypted at rest where the OS keystore allows. `.env*` gitignored.
- **Rate-limit discipline is load-bearing** — exceeding it = 15–30 min IP lockout
  that _stacks_. The governor reads live `X-Rate-Limit-*` headers and self-throttles;
  the scheduler shares one budget across all searches.
- **Auto-travel is explicit opt-in per search** and teleports the real character —
  guard rails: confirm in UI, queue one-at-a-time, never enable by default.
- **ToS posture**: async-trade automation (securable → travel) is what Bartosz
  authorized post-0.3.0; the tool stays on the buyer-driven NPC flow (no whisper
  spam). Recorded as a project decision, not re-litigated each session.
- **No secrets/spec/fixtures with real account data** committed; e2e uses
  recorded/mock PoE responses.

---

## 10. Knowledge to carry over from the prototype (the actual value)

These were hard-won this session — bake them into the new code + tests:

> **No-guessing rule (carried from card-bridge).** The GGG trade API is
> undocumented. Every discovered behaviour gets recorded in
> `docs/integration/api-notes.md` with evidence + date; assumptions in code are
> marked `TODO(verify)`. Never silently assume an endpoint shape.

1. **GGG live WebSocket is currently 504-down** (server-side, post-0.5.0 load).
   Poll is the working fallback; ws auto-resumes when it returns.
   **Tarpit warning:** unauthenticated WS handshakes hang forever — the probe
   must carry session cookies and enforce a connect timeout.
2. **Browser-free travel**: `POST /api/trade2/whisper {token}` with the **decisive
   `X-Requested-With: XMLHttpRequest`** header (+ Referer = search page) → `{success:true}`.
   Without it: 403 code 6, even from inside a real logged-in page.
3. **Instant Buyout filter = `status.option: "securable"`** in the query JSON.
   Only securable listings carry the **`hideout_token`** (JWT, `tok:hideout`, ~300s TTL)
   and a Travel button. Enforce/validate this when adding a search.
4. **Session cookie reality**: POESESSID is a _session cookie_ (dies with the
   browser profile) and guests get one too → login signal is `/my-account` 200, not
   the cookie's presence. Capture the full cookie set while the session is alive.
5. **Cloudflare** blocks headless / bare-automation Chromium (Turnstile loop) →
   real Chrome channel + hidden automation flags, or (desktop) a real `BrowserWindow`.
6. **Real rate-limit values** come from `X-Rate-Limit-*` headers (dynamic), e.g.
   search `~60/300s` per IP. Don't hardcode; read them.
7. **Detection is already pure API** (Node fetch, sub-ms); only travel needed the
   header fix. Both are browser-free now.
8. **Item payload** → `normalizeItemDetail` (rarity/base/ilvl/corrupted + properties/
   requirements + implicit/explicit/rune/crafted mods), markup `[tag|display]` cleaned.
9. **Tooling gotchas**: `pnpm login` is a pnpm builtin — invoke scripts as
   `pnpm run <name>` or avoid reserved names; tsx/esbuild injects a `__name`
   helper that breaks `page.evaluate` — shim it or keep evaluated functions
   self-contained.

See the prototype's git log + `~/.claude/.../memory/project_poe2_live_sniper.md`.

---

## 11. Phased execution (thin-slice, like card-bridge MVP)

> Each phase ends green (verify) and is independently usable. We do NOT decommission
> the old prototype until Phase 5.

- **Phase 0 — Foundation.** Monorepo skeleton, tsconfig/eslint/prettier/husky/CI,
  `packages/shared` types, NestJS app booting with Zod config, SQLite + first
  migration, empty React shell + nav registry. `docs/` system seeded. Green CI.
- **Phase 1 — Detection core (headless).** `trade-api` adapter + ratelimit governor
  - `engines` (ws/poll registry) + `SearchManager` (round-robin, DB-persisted) +
    events bus. CLI/API only, no UI yet. Unit tests for engines, manager, ratelimit,
    item normalization. Reproduces today's detection.
    Session is **bootstrapped by importing the prototype's exported session JSON**
    (behind the `SessionStore` interface); proper capture lands in Phase 4.
    Includes a fixture-capture task: record real trade-API responses **while the
    prototype is still live** — they become the e2e/mock fixtures (scrubbed of
    account data).
- **Phase 2 — Travel.** `TravelService` (browser-free token POST + fallback),
  per-search autoTravel, queue. Tests with mocked trade-api.
- **Phase 3 — Web UI.** React: Searches page, Hits feed + accordion, Settings,
  SSE hook, atomic components, theming. Parity with the prototype's UI, cleaner.
- **Phase 4 — Session/login productionization.** `SessionSource` interface, system-
  browser capture for web mode; encrypted-at-rest session; validity probing.
- **Phase 5 — Desktop (Electron).** Shell wrapping the web build, server in main,
  login via `BrowserWindow`, `electron-builder` packaging for Win/Linux/macOS.
  **Cut over from the prototype here.**
- **Phase 6+ (future_ideas):** analytics from `hits`, multi-account, alert sounds
  per search, price-trend awareness, IPC optimization, signing/notarization.

---

## 12. Decisions log (seed — full log in `40_decisions.md`)

- **D-1** Rewrite from scratch as parallel project; old prototype untouched until Phase 5.
- **D-2** Stack: NestJS + React/Vite/Tailwind + Electron + SQLite/Drizzle, pnpm monorepo.
- **D-3** Scope cuts vs card-bridge: no RBAC/PCI/i18n/NDA; keep the discipline.
- **D-4** Hybrid: one server, two shells; web (HTTP) and desktop (Electron main, BrowserWindow login).
- **D-5** Auto-travel is explicit per-search opt-in; rate-limit governor reads live headers.
- **D-6** (2026-06-12, resolves O-3) SQLite driver = **better-sqlite3** — most battle-tested
  Drizzle pairing, synchronous; Electron rebuild handled by electron-builder at
  Phase 5; swap behind Drizzle is contained if packaging turns ugly.
- **D-7** (2026-06-12, resolves O-1) Session at rest = **plain file, `0600` perms, until
  Phase 4**; `SessionStore` interface defined in Phase 1 so `safeStorage`
  encryption slots in without refactoring.

## 13. Open questions (seed — `30_open_questions.md`)

- ~~O-1~~ resolved by D-7 (plain file until Phase 4, interface from Phase 1).
- O-2 Desktop UI↔core transport: loopback HTTP (simplest) vs Electron IPC — confirm at Phase 5.
- ~~O-3~~ resolved by D-6 (better-sqlite3).
- O-4 Do we want cross-machine sync of searches/history (would reopen the Atlas/cloud question) — park as future idea.

## 14. Future ideas (parking lot — `90_future_ideas.md`)

Analytics dashboard · per-search sound profiles · multi-account · price-trend
filters · "buy budget" guard · shareable search presets · headless cron mode ·
notifications to phone.
