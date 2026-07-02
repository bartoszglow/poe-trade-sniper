# 37 — In-map price check (clipboard → trade2/poe2scout, panel + overlay)

**Status: PHASE A + B IMPLEMENTED** (2026-07-03). Server pipeline + comprehensive versioned
dictionary + in-app panel = `2b77543`; desktop hotkey + click-through overlay = next commit.
Verify green (server 34 files, web 7, desktop 2). **Desktop synthetic-copy + overlay NEED
on-Mac + in-game validation** (same hardware gap as buy-automation native input). Research:
two workflow sweeps (tools landscape + league-data pipeline + macOS overlay mechanics).
Goal: the first usable PoE2 price check on macOS; works IN MAPS (the built-in Shift+Alt+click
check works only in town — the gap this fills).

## Comprehensive dictionary (operator request)

The Tier-1 dictionary is a versioned, diffable `TradeDictionary`
(`apps/server/src/price-check/dictionary-schema.ts`): `meta` (schemaVersion + dataVersion +
realm/league + fetchedAt + per-dataset counts), `stats` (id/text/type/placeholders/options,
`tiers?` reserved for Tier-2), `items` (key/name/baseType/category/flags, `properties?`
reserved), `statics`. `DICTIONARY_SCHEMA_VERSION` forces a rebuild on shape change;
`diffDictionary` keyed-diffs two snapshots (added/removed/changed per dataset) so every
league refresh is auditable and logged, not a black-box overwrite; `needsRebuild` gates on
schema + TTL. Grows to hold "a lot of data" without reshaping what's stored.

## How every serious tool does it (research, high confidence)

Clipboard, not OCR: hotkey → synthetic Ctrl+C in game → the game puts structured item text
on the clipboard → parse → match mod lines against the trade stats dictionary → build a
trade2 query → show comparable listings. Exiled Exchange 2 is the reference implementation
(only tool with a macOS build; community-grade, fragile). Wine's mac driver syncs the game
clipboard to the macOS pasteboard (≤ ~2 s latency), so this works with PoE2 under Sikarugir.

## Decisions

- **D-pc-1 — clipboard pipeline, no OCR.** Same mechanism as every mainstream tool; we
  already own the primitives (uiohook/nut.js input, macOS permission framework, session).
- **D-pc-2 — dynamic budget routing (operator's design).** Before each rare-item query the
  router checks the governor's live SEARCH-bucket headroom: above a tunable reserve
  (`PRICE_CHECK_MIN_SEARCH_HEADROOM`, default keep ≥30% for detection) → official trade2
  via the existing TradeApiClient (hard rule #4 holds); below it → degrade: re-check cache,
  poe2scout for fixed items, honest "budget low" state. Never silently starve detection.
- **D-pc-3 — two-tier dictionary.**
  Tier 1 (core, per user, runtime): fetch GGG's four trade2 data endpoints
  (`/api/trade2/data/{stats,items,static,filters}`) through the governor'd session, cache
  in `app_state` keyed by version/league → **self-updating on league day, no releases**.
  Tier 2 (later, global): tier/roll analytics from game bundles via `pathofexile-dat`
  (public patch CDN) — built once by us, shipped as data files; lagging it never breaks
  the core check.
- **D-pc-4 — hybrid pricing.** Fixed-value items (currency, runes, essences, uniques by
  name) → poe2scout API (cached ~15 min; zero GGG traffic). Rares/magic/bases with mods →
  trade2 search (D-pc-2 routing), sort price asc, fetch top N.
- **D-pc-5 — result sinks as variants (not booleans):** `panel` (price-check section in
  the app) and `overlay` (desktop only). Overlay = transparent frameless BrowserWindow,
  `type:'panel'` + alwaysOnTop `screen-saver` + visibleOnFullScreen + **click-through**
  (`setIgnoreMouseEvents(true,{forward:true})`) near the cursor, auto-hide. Wine
  "fullscreen" is a level-26 borderless window → screen-saver level (1000) renders above
  it (verified in Wine source). Info-only click-through avoids EE2's whole focus-bug class
  and needs no extra permission to display. Known limitation: Wine's off-by-default
  `CaptureDisplaysForFullscreen` blocks all overlays (documented).
- **D-pc-6 — dev↔prod parity:** the web app gets a paste-an-item surface (textarea →
  same `POST /api/price-check`) — usable in `pnpm dev`, doubles as the parser test bench.
- **D-pc-7 — EN-only parser for now.** i18n of ITEM TEXT (9 languages in EE2) is out of
  scope; the UI copy is EN+PL as usual.
- **ToS framing:** user-initiated per keypress, read-only, clipboard-based, rate-limited —
  the exact profile GGG tolerates in APT/EE2. No automation of trade actions.

## Architecture

Server `apps/server/src/price-check/`:

- `trade-data.service.ts` — Tier-1 dictionary fetch/cache (app_state, refresh on version
  change/staleness), exposed matchers built from `/data/stats` text templates
  (`#` placeholders → regex), items/uniques from `/data/items`.
- `item-text-parser.ts` — pure parser for the Ctrl+C format: `--------` sections,
  Item Class/Rarity/name/base, ilvl, quality, sockets, gem level, waystone tier, mod lines
  with ` (implicit)`/` (rune)`/` (enchant)`/` (fractured)` tags, statuses
  (Unidentified/Corrupted/Mirrored). Unmatched mod lines are reported, not fatal.
- `stat-matcher.ts` — mod line → `{statId, values}` against the Tier-1 matcher table.
- `query-builder.ts` — parsed item → trade2 query JSON (uniques: name+type; rares:
  type + stat ranges with tolerance, misc filters ilvl/quality/corrupted; status online).
- `poe2scout.client.ts` — fixed-item prices (non-GGG host; polite caching).
- `price-check.service.ts` — orchestration + D-pc-2 routing + result shape.
- `price-check.controller.ts` — `POST /api/price-check { itemText }`.
- Governor: expose live SEARCH headroom to the router (read side only — no behavior change
  to the load-bearing throttle).

Desktop `apps/desktop`:

- Global hotkey (default Cmd+Shift+D; configurable later) → focus check → synthesize
  Ctrl+C to the game (existing input primitives) → poll clipboard for NEW item text
  (≤2.5 s, Wine sync latency) → `POST /api/price-check` → route to sinks per settings.
- Overlay window per D-pc-5, fed via IPC, renders a compact result card.

Web:

- Price-check panel section (results list: matched stats used, unmatched shown greyed,
  listings with price/seller/age) + paste box (D-pc-6). Sink setting in Settings.

## Phasing (today)

- **A:** server module end-to-end (dictionary, parser, matcher, query, routing, endpoint)
  - web paste surface + panel. Parser validated against synthetic fixtures + real items
    pasted from the operator's live game.
- **B:** desktop hotkey → clipboard → sink routing; overlay window.
- **C (later, parked):** Tier-2 tier/roll analytics; item-text i18n; whisper-from-result.

## Phase D — Price Checks view (2026-07-03)

A full nav view (`/price-checks`, `PriceChecksPage`) — the price-check counterpart to Hits:
a paste-an-item box + the **recent-checks history** (newest first). History is
**session-local + capped (50)** in `PriceCheckProvider` (not DB-backed — price checks are
transient lookups, not audit history; a capped in-memory list matches "recent" and avoids
a table + pruning), so it survives route changes but resets on reload. Every check (paste
here, the Settings bench, OR a desktop hotkey from anywhere) lands in the same history and
the side panel. The single-result rendering is extracted to `PriceCheckResultView` and
shared by the panel, the Settings bench and this view (3-instance extraction).

## Bug fixes post-launch (2026-07-03)

- **League was hardcoded `Standard`** — both trade2 rare search AND poe2scout queried the
  wrong league. Now `SearchManager.getPrimaryLeague()` (most common league among watched
  searches) → config fallback. This was why rares priced against the wrong league.
- **poe2scout endpoints were wrong (404 → every fixed-value item unpriced, looked like
  "unrecognized")**. Real API found via its openapi.json and documented in
  `docs/integration/api-notes.md`: `api.poe2scout.com/api/poe2/Leagues/{League}/Items` +
  `/Currencies/ByCategory`, prices in exalted, per-league. Verified live 2026-07-03.
- Adversarial review (19 agents) earlier fixed the S2 `{query,sort}` envelope + 6 more.

## Remaining / needs validation / parked

- **NEEDS on-Mac + in-game hardware validation** (structure done, unproven): the desktop
  synthetic Cmd+C under Wine + clipboard sync, and the click-through overlay over the game
  (incl. Wine "fullscreen"). Same gap as buy-automation natives. Server+web validated via
  the paste bench; rares can't be live-tested here (hard rule #8) — operator validates.
- **Parked**: Tier-2 tier/roll analytics (game-file `pathofexile-dat` CDN pipeline);
  item-text i18n (EN-only, D-pc-7); whisper-from-result; DB-persisted history (currently
  session-local, capped 50); league fallback when the operator has zero searches (could use
  poe2scout `Leagues` IsCurrent); magic-item base-type extraction (magic items price by
  stats only today, base embedded in the affixed name and not extracted).
