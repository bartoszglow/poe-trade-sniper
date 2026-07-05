# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Deal-watch (server core, plan 41)**: flip any search into deal mode — the app
  computes a price-fixer-resistant market baseline for the item (median of the
  cheapest listings after dropping decoys, all prices normalized to exalted),
  creates its own price-capped search on the trade site (self-generated id,
  auto-updated in place as the market moves — the row's "open on trade site"
  always shows the current capped view), and raises distinct deal alerts with the
  computed discount when a listing undercuts the baseline by your threshold
  (percent, or an absolute amount in exalted/divine). Baseline history is
  recorded per watch for price trends. Operator UI controls arrive in the next
  phase; the API and detection pipeline are fully live.

- **About & Support view** (new nav item): who makes the tool, a calm "support development"
  section with donation buttons, and non-monetary ways to help — plus a GGG fan-tool
  disclaimer. Links live in one config; buttons appear as they're filled in.
- **Open a search on the trade site**: each search row now has an external-link button
  that opens its Path of Exile trade page in the browser.
- **Hover popovers on the status badges**: the POLL / WS / ACTIVE (and every other status)
  badge now explains itself on hover or keyboard focus.
- **macOS permissions in Settings** (desktop only): Screen Recording +
  Accessibility toggles that reflect the live OS status and prompt / deep-link to
  grant them — the foundation for screen-capture-based automation.
- **Per-search Buy automation** (macOS desktop only, opt-in): on a successful
  travel it focuses the game, finds the open trade window, and moves the cursor
  onto the selected item. It never clicks — you confirm the purchase. Requires
  the Screen Recording + Accessibility permissions; independent of auto-travel.
- The Searches view shows a clear "log in to start sniping" prompt with a button
  to Settings when there is no valid Path of Exile session, instead of an
  add-search form that could not work yet.
- **Database export / import** (Settings → "Backup / data"): export your configured
  searches as a restorable JSON file and the hits + activity logs as CSV (opens in
  Excel), and import searches back (skip or replace). Credential-free by design — the
  encrypted session is never exported; the import is strictly validated (and CSV cells
  are guarded against spreadsheet formula injection).

### Fixed

- **Faster reaction on contested bursts.** When several matching listings dropped at once, they
  were fetched one-by-one (each waiting on the rate-limit spacing), so the 5th could lag seconds.
  They're now coalesced into a single fetch — the first still fires instantly, the rest ride
  along. Also removed a per-hit disk-sync that sat in front of the auto-travel trigger. (No
  change to the rate-limit safety margins.)
- **Window title no longer overlaps the macOS window buttons**, and the app shows its proper
  name **"PoE Trade Sniper"** in the title bar (the traffic lights are pinned so the title
  clears them on every macOS version).
- **Travel failures now say _why_.** A failed teleport shows a clear reason parsed from GGG's
  response — e.g. a calm "no longer available" (muted, not alarming) when the item sold before
  you arrived, or "rate-limited — try again shortly" — instead of a generic red "failed". Other
  cases keep the plain "failed" with the raw detail on hover.
- **Enabling detection no longer bursts past the connection limit.** Turning detection back
  on with many searches used to open all their live connections at once and trip the rate
  limit; the searches now start one-by-one with a short (500 ms) gap between each.
- Dropped the redundant "live websocket connected" line under an active search — the WS badge
  (now with a hover explanation) already says it; error/degraded details still show.
- **Travel retry on aged hits now works.** Retrying travel/buy on an old live hit used to
  fire the stored hideout token, which is dead by then (~300 s TTL) — and GGG re-serves
  offers under fresh ids, so the old id may not resolve either. The retry now re-resolves a
  FRESH token (re-fetch by id, else re-search matched by offer identity) before travelling;
  if the offer is gone it says "no longer listed" instead of failing silently. Auto-travel
  is unchanged (fire-once on fresh hits; never re-searches).
- Live WebSocket detection now actually delivers hits on PoE2 (it was silently
  doing nothing and the search ran on polling only). Two distinct bugs, both
  found by comparing our socket to a real browser tab against live GGG:
  1. We sent a WebSocket keepalive ping every 30s. A browser cannot send ws
     ping frames, so GGG's live endpoint treats a client ping as a policy
     violation and closed every connection with code 1008 at the 30s mark —
     which is why the socket never stayed up and detection fell back to polling.
     We now stay silent and let the library auto-pong GGG's server pings, like a
     browser; the socket holds for minutes.
  2. PoE2's live feed does not send `{"new":[ids]}` (the PoE1 shape we parsed) —
     it sends one `{"result":"<jwt>"}` per new listing, an opaque short-lived
     signed fetch token. We now pass that token straight to
     `/api/trade2/fetch/<token>?query=<id>&realm=poe2`, exactly as the official
     client does, so a new listing becomes a hit within seconds.

## [0.1.0] - 2026-06-13

First public release: cross-platform desktop installers (Windows, macOS,
Linux) published via GitHub Releases, with a lightweight in-app update check.

### Added

- Lightweight in-app update check: the app polls `GET /api/update` (GitHub
  Releases for a configurable `owner/repo`) and shows a "new version available
  — download" banner that opens the installer in the real browser. No silent
  install (that needs a signed/notarized build); dormant until the repo is set.
- Hits view overhaul: free-text search (item or seller), date-range filter,
  sort (newest / oldest / name), and infinite scroll that lazy-loads 20 at a
  time with a loading spinner — backed by a paginated, filtered, sorted
  `GET /api/hits`. The expanded item detail now renders as the same group cards
  as the search-criteria view (shared `DetailCard`), so the two read alike.
- Live hits show a relative "x ago" time (recalculated live) next to the
  absolute detection time, and a manual **Retry** button when an auto-travel
  failed (enabled while the hideout token is still fresh).
- Developer "Network" view + shareable log file: every GGG request/response and
  live-socket event is captured (redacted — never a cookie, User-Agent or
  hideout token) at the two existing choke points (`TradeApiClient.request`,
  `WsEngine`). One `NetworkLog` sink fans out to an in-memory ring
  (`GET /api/network`), a live `network` SSE event, and a rotating JSONL file at
  `LOG_DIR` (always written, so an end user can share it). New `/network` page
  (live table, filters, detail expand, log-path copy) gated by a Settings
  toggle — hidden for an operator build, file logging stays on.
- App-bar detection pills (WS / POLL) showing the global push-vs-poll posture,
  lit from the live searches list — they follow ws→poll demotions and
  re-promotions in real time.
- Search criteria view: every search row gets a criteria accordion and the
  add form a "Show criteria" preview (`POST /api/searches/preview`, resolve
  without persisting). Stat ids resolve to human labels via the new
  `GET /api/stats` dictionary (server-cached static game data); the renderer
  never hides data — unrecognized query parts show as raw JSON.
- Custom listbox Select matching the PoE theme (closes on selection,
  keyboard navigation, gold check on the selected row) — replaces the
  native dropdown that ignored the dark theme.
- Full i18n (English + Polish) mirroring the card-bridge pattern: typed
  message catalog (`EN` as const drives the key set, `PL` compiler-checked),
  `I18nProvider` with localStorage persistence and `Intl.PluralRules`
  (Polish one/few/many), language select in Settings, `translateStatic` for
  out-of-tree code (system notifications). Every user-facing string swept
  into the catalog.
- Alert volume control in Settings: gain-scaled WebAudio synth (0–100 %,
  persisted), themed `Slider` atom, preview on release. System notifications
  are sent `silent` so the slider governs all alert audio.
- Per-search ACTIVE toggle: pause a search without deleting it (persisted
  `enabled` flag, migration 0003) — the engine stops, config and hit history
  stay, re-enabling restarts detection; paused searches boot as `stopped`.
- Phase 5 desktop: frameless window (traffic lights over the app bar,
  data-shell switch via preload), server bundled to one CJS file (esbuild —
  enabled by the explicit-@Inject rule), electron-builder .dmg (arm64,
  unsigned) with web build + migrations as resources and better-sqlite3
  rebuilt for Electron automatically.
- Phase 4 session productionization: session encrypted at rest (AES-256-GCM,
  key in the OS keychain — D-7 closed); in-app "Log in with Path of Exile"
  for web mode (real Chrome + CDP cookie capture, probe-gated); boot-time
  session validity probe. Security review pass: loopback-only bind,
  Host-header guard (DNS-rebinding), Electron renderer hardening, isolated
  e2e server (was able to wipe the dev session).
- Outbound safety guard (runaway watchdog): hard per-minute ceilings on all
  GGG HTTP/ws traffic, trip-and-halt with red UI banner and manual reset
  (`POST /api/guard/reset`); ws reconnect ladder resets only after a stable
  connection; close code 1013 jumps to max backoff; ws→poll demotion after
  repeated unstable cycles; hit-history pruning (`HITS_MAX_ROWS`); hit alert
  sound with Settings toggle; expired-session banner.
- Preliminary Electron desktop shell (`apps/desktop`): embedded NestJS server
  in the main process serving the web build over loopback (one origin); dev
  mode (`SNIPER_DEV_URL`) rides the Vite/tsx watch stack with full HMR;
  `preview` mode runs the embedded server with the better-sqlite3 Electron-ABI
  swap (`abi:electron`/`abi:node`). Live ws reconnect ladder + league select
  from live trade data + D-14 URL-as-source-of-truth form simplification.
- Phase 3 web UI: live SSE event stream into the shell (one `EventSource`,
  capped live-hits feed, per-listing travel states); Searches page (add by
  id/URL, purchase-type + AUTO inline edits, live engine/status badges);
  persistent live-hits panel with token-gated Travel button; Hits history
  with item-detail accordion; Settings (session card with live probe via new
  `POST /api/session/probe`, cookie-paste form, in-app login placeholder per
  D-12, rate-limit budgets); status bar shows session/budget/travel queue.
- Phase 2 travel: browser-free hideout travel (`/api/trade2/whisper` with the
  X-Requested-With header discipline) under a dedicated whisper rate-limit
  policy; `TravelService` FIFO queue (one travel at a time, stale tokens
  dropped); auto-travel as a hit-event consumer (per-search opt-in); manual
  `POST /api/travel`; `travel` lifecycle events on SSE and travel section in
  `/api/status`.
- Phase 1 detection core: trade-api adapter (single GGG gateway), rate-limit
  governor driven by live `X-Rate-Limit-*` headers, ws/poll engine registry
  with tarpit-guarded probe and automatic poll→ws upgrade, SearchManager with
  shared round-robin scheduler and hit persistence, session module (manual
  cookie paste + prototype import behind `SessionStore`), per-search purchase
  mode (Instant Buyout verified, rest `TODO(verify)`), RealtimeBus → SSE
  stream, REST API (`/api/searches`, `/api/hits`, `/api/status`,
  `/api/session/*`, `/api/events`).
- Phase 0 foundation: pnpm monorepo, strict TypeScript, ESLint/Prettier, Husky
  hooks (lint-staged, audit, gitleaks), CI.

### Changed

- Per-search auto-travel toggle is now labeled "TRAVEL" (was "AUTO").
- Detection now runs **one persistent ws connection per search** (like a single
  browser trade tab) with a poll engine that covers only the reconnect gaps.
  The ws engine never gives up — every close, including 1013 "Try Again Later",
  just reconnects on a backoff ladder — so it stops churning connections (the
  cause of the constant 1013 bounce that left searches stuck on poll ~95% of
  the time). When ws is connected poll is off (no double traffic); when ws
  drops poll covers instantly (no detection gap). Replaces the earlier
  ws→poll demote + shared re-promotion probe.

### Fixed

- Hit count and last-hit time are restored from persisted hits on startup —
  a long-running search no longer shows "0 hits" after every restart (the
  counters were in-memory only and reset to zero on boot).
- Auto-travel no longer re-fires for a listing that re-enters the live
  stream after traveling to it and returning without purchasing —
  successfully-traveled listing ids are remembered
  (`TRAVEL_DEDUPE_MAX_ENTRIES`, default 500); manual travel and retries
  after a failed travel are unaffected.
