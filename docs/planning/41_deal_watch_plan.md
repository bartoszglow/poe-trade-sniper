# 41 — Deal-watch (discount sniping for flipping)

**Status: Phase 1 (server core) IMPLEMENTED (2026-07-05)** — commits `ebfd382`
(shared model + migrations 0011/0012 + config), `079d254` (market-data
extraction + governor minHeadroom), `9e0a2d8` (deal-watch core), `21049dd`
(web deal-event handling), `531842c` (docs + review record). Verify green
(server 46 test files / 320+ tests incl. ~60 new, web 10, desktop 3). Shipped
after an 8-specialist adversarial review (34 verified findings — all confirmed
S2/S3 + S4 batch fixed pre-commit, F24 deferred; record:
`docs/process/reviews/2026-07-05-deal-watch-phase1.md`).

**Phase 2 (operator UI + stackable gate) IMPLEMENTED (2026-07-05, same session)**
— DealWatchModal (config editor, baseline card, trend sparkline with re-derive
markers, detection honesty, cooldown-aware refresh, restore-explaining disable),
row deal chip + status dot, deal rendering in live panel/hits/activity (new
`deal` feed kind + chip), distinct three-tone deal sound + flip-context
notification, EN+PL for all 12 status codes + coded 409s, `unsupported-item`
stackable gate (closes the Phase 1 deviation), id-lock in the edit dialog.
Built in three parallel slices, then a 3-lens adversarial review (10 findings:
3 S2 + 7 S3 — ALL fixed pre-commit, incl. watchId-stable React row keys so
re-derives never unmount an open modal). Verify green.
**Remaining: P0.2b multi-day id aging** (interim ~2 h evidence positive, see
api-notes), **Phase 3 live validation with the operator**, parked items below.

Phase 0 record: gate PASSED, direction confirmed by operator; Q1/Q2 resolved. Phase 0 results
(evidence in `api-notes.md`, "Self-created searches + price filters"): P0.1/P0.3
PASS (POST → id `5nv8453oTa` → resolve → fetch → live ws, end-to-end); P0.7 ids
are content-addressed (identical query → same id — swap no-op guard validated,
abandoned-id trail moot); P0.4 caps with `option` are currency-LITERAL, caps
**without `option` value-convert in exalted** → D-dw-6 updated to the no-option
cap; P0.5 poe2scout ApiId == GGG currency code, DivinePrice live; P0.9 `online`
accepted (strict filtering still TODO(verify)); P0.8 bogus id → resolve 404 /
fetch silent nulls → expiry detection via resolve only; P0.6 discovered the
Account rate-limit rule (3:5:60). **Pending: P0.2b id aging** (probe search
`[P0 probe]` left watching; re-check next day+) — Phase 1 may start, `DEAL_MAX_ID_AGE_MS`
default stays conservative until P0.2b lands.
v2 folded in a 5-lens adversarial critique (27 findings). v3 is an operator-decided
pivot (D-dw-1): **no parent+shadow pair — deal mode transforms the search itself**,
with its GGG id auto-updated in place (mirrors the operator's manual workflow of
re-pointing a search's id when the market moves). This supersedes v2's
hidden-derived-row visibility architecture and the offer-race rule, both now moot.

## Why

The operator flips items: buy listings that appear well below the going rate, resell at
the going rate. Today the sniper only watches static searches; when the market moves,
the operator manually rebuilds the search on the trade site and re-points the app row
to the new id. Deal-watch automates exactly that loop: flip a search into **deal mode**,
and the system maintains its price cap against the live market, alerting only on
listings ≥X% (or an absolute amount) below the item's baseline price.

## Requirements (operator's words, 2026-07-04/05)

- **R1** — Given a search, notify when the item is listed ≥30% (or an absolute amount,
  e.g. 5 divine) below the standard lowest price.
- **R2** — The system creates/updates the trade-site search itself (self-generated GGG
  id).
- **R3** — Hourly, re-check the standard price; if it moved >5%, update the search with
  the newest cap **so discount math stays correct** (see "Baseline persistence").
- **R4** — The discount threshold is editable per search at any time.
- **R5 (v3, operator decision)** — **One search, not two.** Deal mode is an option ON
  the search: the original price filter is ignored (snapshotted for restore), and the
  system auto-updates the search's id both in the background AND in the Searches view,
  so "open on trade site" always lands on the current, freshly-capped result.
- **R6** — Verify we can self-generate search ids and update them (Phase 0).
- **R7** — All generated traffic must look like a standard browser user.

**v1 scope limit:** non-stackable items (uniques / equipment / jewels). Stack-priced
listings (currency, essences, catalysts…) have no per-unit price handling anywhere in
the codebase and GGG's stack-price semantics are unprobed — a baseline over mixed stack
sizes would be silently garbage. The deal config UI warns (and the service refuses with
status `unsupported-item`) when the query targets a stackable category. Per-unit
normalization is parked (needs its own probe).

## What the codebase already gives us (evidence)

- **POST-created search ids**: `TradeApiClient.priceSearch` POSTs a self-built query and
  reads back `id` for the follow-up `/fetch?query=` (trade-api.client.ts:353-362) —
  exercised live by #37. api-notes.md:16 documents the response only as
  `{result, total}`; the `id` field is coded but **not yet in the evidence log**.
- **Price-filter shape (parse-side only)**:
  `filters.trade_filters.filters.price = {min?, max?, option?: <currency>}` — evidenced
  by the web criteria parser reading real resolved queries
  (apps/web/src/lib/query-criteria.ts:139-155, 234-236). Never POSTed by us.
- **Query JSON per search is stored**: `searches.filters` holds the full resolved trade
  query (search-manager.ts:266); the poll engine re-POSTs it every tick
  (`executeSearch`), which is why the _stored_ query must be the capped one (see data
  model).
- **Cheapest-first search + listing prices**: `priceSearch` (`sort {price:'asc'}`,
  ≤10 listings per fetch) is the baseline primitive — but note both `sort {price:'asc'}`
  and `status {option:'online'}` are themselves unevidenced in api-notes (P0.8/P0.9;
  pre-existing #37 gap this plan closes rather than compounds).
- **Exchange-rate raw material**: poe2scout `Currencies/ByCategory` returns
  `CurrentPrice` in exalted per currency and `/Leagues` carries `DivinePrice`
  (documented 2026-07-03) — but the current client keys by display `Text`, discards
  `ApiId` and `DivinePrice`, and is a non-exported provider of PriceCheckModule
  (poe2scout.client.ts:83-88, 148-151) → extraction required, see D-dw-3.
- **Id-swap transaction**: `editSearch` inserts the new row, re-points hits, deletes the
  old row and swaps the watcher in place — including its two load-bearing guards
  (same-id early return :390-393, already-watched conflict :394-396). Deal-mode
  re-derivation extracts and reuses this transaction body (D-dw-7). The operator's
  manual "market moved → paste new URL" workflow already runs through it — deal mode
  automates the identical mechanism.
- **Human-behaviour choke points**: every HTTP call already flows through
  `TradeApiClient.request()` (cookies/UA/Origin/timeouts) + `RateLimitGovernor` +
  `OutboundGuard`; ws connects are staggered, jittered, and 1013-aware. Deal-watch adds
  no new outbound path — only new _callers_ of existing ones (R7 holds by construction
  for HTTP; ws pacing handled explicitly, D-dw-8).

## Load-bearing unknowns — Phase 0 live probe (operator at the machine)

Hard rules #2/#8: probes are operator-run against live GGG, findings land in
`docs/integration/api-notes.md` with date + evidence, fixtures get recorded for tests.

- **P0.1 — POST a price-capped query.** Take an existing search's stored `filters`, add
  `trade_filters.filters.price = {max: N, option: 'exalted'}`, POST it. Accepted?
  Returns `id` + plausible result ids? Also record acceptance of `sort {price:'asc'}`
  on the same POST and the `X-Rate-Limit-*` headers.
- **P0.2 — Id durability.** GET-resolve the returned id; open it as a trade-site page
  URL. Re-check the same id later the same day AND next day (idle id), and separately
  an id that was live-watched in between (active id) — do they age differently?
  (Also feeds restore-on-disable: can we swap back to a remembered original id, or must
  we re-POST the original query?)
- **P0.3 — Live-watchable.** Connect `wss…/api/trade2/live/<realm>/<league>/<id>` with
  the session cookies: auth ack? live frames when a matching listing appears?
- **P0.4 — Cross-currency cap semantics.** Does a `price {max, option:'exalted'}` filter
  match a listing priced in divine (GGG converting at its own rate), or only
  exalted-priced listings? Decides whether the GGG cap is authoritative or a pre-filter
  (D-dw-6). While there: compare GGG's price-asc ordering of a mixed-currency result
  set against poe2scout-normalized order (ordering bias feeds the baseline sample).
- **P0.5 — Currency-code mapping.** Confirm GGG listing `currency` codes (e.g.
  `divine`, `exalted`, `regal`) match poe2scout `ApiId`s in `Currencies/ByCategory`.
- **P0.6 — Creation-rate observations.** Any sign that _creating_ (new query → new id)
  is policed differently from re-running; anything suggesting an account-level cap on
  created searches or concurrent live sockets; whether created ids surface in any
  account-visible list (trail concern).
- **P0.7 — Id determinism.** POST the _identical_ query twice (and once more after
  abandoning the id): same id back (content-addressed dedupe) or fresh each time?
  Either answer is fine — the swap is collision-tolerant (D-dw-7) — but it must be
  recorded; it also settles the abandoned-id-trail question.
- **P0.8 — Expired/invalid id behaviour.** ws handshake against a bogus/expired id
  (close code? tarpit?); `/fetch` with an invalid `query=` slug (status? body?). Feeds
  the `derived-expired` detection + recovery path.
- **P0.9 — `status {option:'online'}`.** Not in the api-notes status table (only
  `securable` is verified) despite #37 POSTing it since it shipped. Verify it is
  accepted and actually filters to online sellers; backfill the api-notes entry and the
  `TODO(verify)` on the price-check builders.

**Phase-0 gate — a fallback ladder, not a binary:**

| Outcome                                | Consequence                                                                                                                              |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| P0.1 fails (capped POST rejected)      | Feature as designed is dead → revisit (e.g. uncapped deal-mode search + local discount filtering; new budget sketch + operator sign-off) |
| P0.2 fails (ids short-lived)           | Keep the design; re-derive on the observed id lifetime instead of drift-only (bounded id age becomes mandatory)                          |
| P0.3 fails (no live ws on created ids) | Keep the design poll-only for deal-mode searches; honest latency caveat, ws upgrade parked                                               |

## Core design

### D-dw-1 (v3, operator decision 2026-07-05) — deal mode transforms the search itself

**One search row. No shadow, no parent/child.** Enabling deal mode on a search:

1. **Snapshot** the current GGG id (`originalSearchId`) and the original
   `trade_filters.price` filter (if any) into the deal config — for restore on disable.
2. **Definition** = the search's query minus its price filter. Stored in the deal
   config (`definition` JSON); this is what the baseline is computed from and what
   re-derives are built from. The operator's original cap is deliberately ignored while
   deal mode is on (R5).
3. **The row's `filters` column always holds the currently-watched capped query**
   (definition + current auto-cap). This is load-bearing: the poll engine re-POSTs
   `row.filters` every tick, and the criteria view renders it — both automatically
   reflect the live cap.
4. **The row's id IS the current derived GGG id** — auto-updated on every re-derive via
   the extracted `editSearch` transaction (insert new id row carrying all fields →
   re-point hits → delete old row → swap watcher in place, order/room/label/flags/hit
   history preserved). The Searches view learns the new id from the normal
   `searches-changed` SSE event; the "open on trade site" IconLink is therefore always
   current with zero new UI code (R5).

Disabling deal mode: restore the definition + original price filter into `filters`,
then swap back — GET-resolve `originalSearchId` and reuse it if it still resolves
(P0.2), else re-POST the restored query for a fresh id. Deal state clears.

**Data model (migration 0011):** one nullable JSON column `searches.deal_watch`
(zod-validated at read, type in `packages/shared`):

```
{
  mode: 'percent' | 'absolute',
  thresholdValue: number,            // 30 (%) or 5 (amount)
  thresholdCurrency: string | null,  // absolute mode; required there, default 'divine'
  definition: TradeQuery,            // query minus price filter (baseline + derive source)
  originalSearchId: string,
  originalPriceFilter: PriceFilter | null,
  baseline: {amountExalted, sampleSize, rawLowest, computedAt, listingsSeen} | null,
  capBaseline: Baseline | null,      // snapshot that produced the CURRENT cap (drift ref)
  cap: {amount, currency} | null,    // what is actually POSTed
  derivedCreatedAt: string | null,   // for max-id-age forced re-derive
  status: DealWatchStatusCode,
  nextRefreshAt: string | null
}
```

`deal_watch IS NULL` = ordinary search. No separate table: the config's lifecycle is
identical to the row's (1:1, carried wholesale through id swaps), the API surface is
the existing `PATCH /api/searches/:id`, and with the FK pragma OFF a same-row JSON
column removes a whole class of re-pointing bugs. Precedent: `price`/`item`/`steps`
JSON columns.

**What this deliberately changes vs an ordinary search:** while deal mode is on, the
system owns the row's id and price filter — the edit modal disables the id/URL input
(hint: "managed by deal-watch") and `update`/`editSearch` reject manual `input` changes
for deal-mode rows. Everything else (label, room, ACTIVE, TRAVEL, BUY, archive) behaves
exactly as today. A deal-mode search alerts **only on deals**; an operator who also
wants the full uncapped stream keeps a second ordinary search — their explicit choice,
no system-created duplication.

**What v3 makes moot from v2:** the hidden-row visibility architecture (envelope
flagging, `isOperatorRow`, ownership guards beyond the id-edit rule), the
parent/derived offer-race rule (one search → one owner in `LiveOfferRegistry`), and
the poll-rotation dilution cost (no extra rows exist).

### D-dw-7 — Deal-derive seam (SearchManager API)

`add()`/`editSearch()` are input-string + `resolveQuery` coupled — a deal re-derive is
born the other way (build query → POST → read id). SearchManager gains a minimal
internal API used only by the deal-watch module:

- `swapSearchId(currentId, {newId, cappedQuery})` — the `editSearch` transaction body
  extracted into a shared private helper, **keeping both guards**: `newId ===
currentId` → no-op success (update `filters`/cap only); `newId` collides with
  another watched row → no swap, deal status `derive-conflict`. Restart rides the
  pending/stagger drip (D-dw-8), never a direct `startWatcher`.
- `getDealSearches()` / narrow readers for the drift loop.

SearchManager's public operator API is otherwise untouched; the deal-watch module owns
baseline/drift/derive logic and calls this seam.

### Baseline service (R1, R3)

`DealBaselineService.computeBaseline(dealConfig)`:

1. Build the **baseline query** from `definition`: force `status {option:'online'}`
   (pending P0.9), `sort {price:'asc'}`, no price filter.
2. One `priceSearch`-style call (1 search POST + 1 fetch, ≤10 listings) through the
   existing client + governor.
3. Normalize to **exalted** via `CurrencyRateService` (D-dw-3). **Usable listing** =
   price non-null AND amount > 0 AND currency known to the rate map. Unusable listings
   are excluded and counted.
4. If usable < `DEAL_MIN_SAMPLE` → status `insufficient-data`, keep previous baseline,
   no alerts (an illiquid item has no meaningful "standard price").
5. Robust statistic (D-dw-2, operator-confirmed): sort usable ascending; drop leading
   outliers (listing < `DEAL_OUTLIER_RATIO` × median of the usable sample); if
   survivors == 0 → `insufficient-data`; baseline = **median of the cheapest
   `min(K, survivors)`**. Keep `rawLowest` for display.

**Baseline persistence (R3 intent):** `baseline` is persisted on **every successful
refresh** regardless of drift — live discount math and alert decisions always use the
newest price. Drift (`|new − capBaseline| / capBaseline > DEAL_DRIFT_THRESHOLD`) is
measured against **`capBaseline`** — the snapshot that produced the _current cap_ — so
a slow 3%/hour drift correctly accumulates and re-derives; the cap can never diverge
unboundedly.

**Budget gate:** skip the refresh when
`minHeadroom(['search','fetch']) < DEAL_MIN_HEADROOM` (0.15 after D-dw-18; the
background market loop uses the higher `MARKET_CHECK_MIN_HEADROOM`). The
`min(headroom…)` helper is **extracted to the governor** and shared with
PriceCheckService's `currentHeadroom()` (second consumer of D-pc-2 logic). Refresh
ticks also **no-op while detection is globally paused or the guard is tripped** —
operator pause means zero GGG traffic, deal-watch included. In all skip cases the
baseline goes **stale honestly** (status `baseline-stale` after
`DEAL_BASELINE_STALE_MS`); alerts keep firing on stale baselines with the stale flag
carried in the deal event + UI.

### D-dw-3 — Currency normalization (market-data module extraction)

`Poe2ScoutClient` moves from PriceCheckModule to a new exported **`market-data`
module**; it is extended to retain `ApiId` (the GGG-code key P0.5 relies on — today it
keys by display `Text` and discards `ApiId`) and `DivinePrice`. `CurrencyRateService`
(same module) exposes `toExalted(amount, currencyCode)` over an ApiId-keyed map,
15-min TTL as today. Both PriceCheckModule and DealWatchModule import market-data —
the extraction the second consumer forces. Added poe2scout courtesy load: ≤4 map
refreshes/hour — accepted (non-GGG, off-budget, cached).

### Drift loop (R3)

New interval owned by `DealWatchService` (no scheduler infra exists to reuse —
SearchManager's tick is detection-scoped):

- **Relative scheduling, not phase-anchored**: `nextRefreshAt = now +
DEAL_REFRESH_INTERVAL_MS × (1 ± DEAL_REFRESH_JITTER_RATIO)` per search — the phase
  random-walks across days (no metronomic hourly signature; R7). A threshold-edit
  re-derive resets that search's timer.
- On refresh: recompute + persist baseline → drift vs `capBaseline` >
  `DEAL_DRIFT_THRESHOLD` → recompute cap → re-derive.
- **Forced re-derive on id age**: independent of drift, re-derive when
  `derivedCreatedAt` is older than `DEAL_MAX_ID_AGE_MS` — id lifetime is bounded even
  in a flat market (P0.2/P0.8 feed the default).
- **Re-derive = one global serialized queue.** Triggers (hourly drift, debounced
  threshold edit, manual refresh, id-age, `derived-expired` recovery, enable/disable
  transforms) enqueue; one re-derive in flight process-wide,
  `DETECTION_STAGGER_MS`-paced, coalescing per search (last trigger wins). After every
  await the job **revalidates** (row still exists, deal mode still on, id unchanged
  since capture) before the swap — the `startWatchersStaggered` post-await pattern.
- Swap details per D-dw-7 (collision-tolerant). Old GGG ids are abandoned (P0.7 tells
  us whether identical queries even mint distinct ids).
- **Known blind window (accepted, documented):** between old-watcher teardown and the
  new watcher's first serve (poll's first round is a baseline; ws pushes only new
  listings), a deal listed in that gap is missed. Bounded by the drip latency
  (~seconds); parallel old+new watchers were rejected (double sockets, ownership
  complexity).

### D-dw-8 — ws-connect pacing (guard safety)

All deal-driven watcher (re)starts go through the **pending/stagger drip**
(`startPendingWatchers`), never direct `startWatcher`. Rationale: the drip's pacing
reserves ~2 connects/min of the 12/min guard ceiling for churn; enable/edit bursts with
immediate starts could breach it, and a guard trip is **latched** (all outbound halted
until manual operator reset). With the drip + the global re-derive queue, worst case
stays ≤1 deal connect per drip gap by construction.

### Deal condition & hit flow (R1)

- Cutoff: `percent` → `baseline × (1 − value/100)`; `absolute` →
  `baseline − toExalted(value, currency)`. GGG cap = cutoff exactly (v1;
  `DEAL_CAP_MARGIN_RATIO` exists, default 0, pending P0.4 — see Q3).
- **Enrichment is persistence-time, not publish-time**: `recordHits` consults a
  **`HitDecoratorRegistry`** _before_ the insert transaction so the `deal` JSON column
  lands in the same transaction as the hit row; the event is built from the same
  decoration. Registry wiring avoids a module cycle by **self-registration**:
  SearchModule provides the mutable registry token; DealWatchModule imports
  SearchModule and registers its decorator in `onModuleInit` (one dependency
  direction, no `forwardRef`).
- The decorator recognizes deal-mode rows (`deal_watch` non-null): computes the exact
  discount against the live baseline and emits **`deal`** (new `DomainEvent` member)
  carrying `{listing, searchId, baselineExalted, discountPercent, discountExalted,
baselineStale}`. The `updated` branch gets a **`deal-updated`** twin (mirrors
  `hit`/`hit-updated`, feed-only, never re-triggers actions). Baseline missing/stale:
  **never a bare `hit`** — emit `deal` with null discount fields + status surfaced.
- Sub-threshold suppression: hits whose live-baseline discount < threshold (baseline
  moved down since derive, or future cap margin) are persisted as hits but emit **no**
  alert event — history-only.
- Hit persistence: nullable `deal` JSON column on `hits` (migration 0011) so
  Hits/Activity history keeps discount context; CSV export gains the column.
- Auto-travel/auto-buy: the search's own existing flags — **default off, explicit
  opt-in** (hard rule 5). `TravelService.maybeAutoTravel` extends its subscription to
  `deal` events with identical gating (never `deal-updated`).
- First-connect: poll's first round is a baseline (never alerts) and ws pushes only new
  listings — enabling deal mode does not flood alerts for listings already under the
  cap.

### API surface

All on the existing searches resource — deal mode is a search option, not a resource:

- `PATCH /api/searches/:id` — `UpdateSearchPayload` gains
  `dealWatch?: {mode, thresholdValue, thresholdCurrency?} | null` (null = disable +
  restore). Enable computes the initial baseline + derives (status `pending-derive`
  until the first swap lands); threshold edits debounce `DEAL_REDERIVE_DEBOUNCE_MS`
  then enqueue. Absolute mode defaults `thresholdCurrency` to `'divine'`. Manual
  `input` (id/URL) changes are rejected with 409 while deal mode is on.
- `POST /api/searches/:id/deal-refresh` — manual baseline re-check. **Gated like the
  automatic one** (headroom gate → `budget-low`), per-search cooldown
  `DEAL_MANUAL_REFRESH_COOLDOWN_MS` (default 60 s), in-flight dedupe (second click
  joins the running refresh). The governor is FIFO with no priority classes — an
  ungated endpoint would let click-spam queue ahead of detection polls.
- `SearchRuntimeInfo` carries the deal state (config + baseline + status) — the web
  reads everything from the existing envelope; `searches-changed` keeps the id fresh.
- Lifecycle: DELETE/archive/restore need no deal-specific handling (one row — engines
  stop/start as today; the drift loop skips archived/disabled rows). Boot: rows in
  `pending-derive`/`derived-expired` re-enter the re-derive queue.

### Web UI (operator view — built directly, no mockup; responsive like every UI)

- **SearchRow**: a **DEAL control** next to ACTIVE/TRAVEL/BUY — a gold chip (Badge)
  showing `−30%` / `−5 div` + status dot when configured, a ghost IconButton
  (`BadgePercent`) when not. Click opens **`DealWatchModal`** (new component file —
  SearchesPage.tsx is past the god-file threshold; nothing new goes inline): mode
  Select (variants-as-enum), threshold inputs (PriceCheckEditor number-input pattern),
  currency Select (pre-selected `divine`) for absolute mode, live summary line
  ("alert ≤ 516 ex ≈ 0.7 div"), baseline card (value, raw lowest, sample size,
  refreshed-at, stale/insufficient warnings), **detection status** (ws/poll/degraded —
  a poll-degraded deal search is effectively blind for sniping; shown honestly, see
  Budget), manual refresh button (cooldown-aware), disable via ConfirmDialog
  (explains the id/filter restore). **Broad-query warning** when the definition pins
  neither `name` nor `type` (criteria parser already extracts this): "broad search —
  baseline may mix different items" (warn, not block). Modal follows the existing
  responsive modal pattern (fluid width, stacked sections, scrollable under `sm`).
- **Edit modal**: id/URL input disabled with a hint while deal mode is on (the system
  owns the id).
- **Deal rendering**: `HitCard`/`HitsPage`/`ActivityFeedCard` render `deal` entries as
  the hit card + discount Badge (`−32%`) + baseline context line
  ("listed 360 ex · resale ≈ 516 ex, +156 ex"); new `FeedKind 'deal'`
  (compile-enforced KIND registry + KIND_CHIPS row) with its own accent. The web live
  feed folds by offer identity — folding a later plain re-serve onto a deal card
  **merges** (deal fields persist) rather than replaces.
- **Locate/spotlight**: unchanged (one row). A displayed card can hold a pre-swap
  searchId; the web resolves it via `lastKnownIds` from the deal state (the envelope
  exposes `originalSearchId` + current id) — worst case the chip hides, as today when
  a search is gone.
- Notifications: system notification body carries the flip context — "listed 360 ex ·
  resale ≈ 516 ex (+156)" — and the title `DEAL −32% · <item>`. Deal sound = a
  **distinct variant** of the existing chirp (slightly higher/louder — deals are
  time-critical; operator asked for marked + louder). Both respect existing toggles.
- i18n: every new string EN+PL; `DealWatchStatusCode` maps code→message exactly like
  `EngineStatusDetailCode` (raw errors never rendered).

### Export/import (v4)

- The search entry gains the `dealWatch` config subset only: `{mode, thresholdValue,
thresholdCurrency, definition, originalSearchId, originalPriceFilter}` — runtime
  state (baseline, cap, status, derived id age) never travels.
- Import recreates deal-mode rows in `pending-derive` (they re-derive fresh via the
  queue on the importing machine); the exported row id may be a dead derived id —
  import already inserts `filters` as-is without resolving, and the first re-derive
  replaces the id anyway.
- `searchEntrySchema` (`.strict()`) gains the optional `dealWatch` key; v>4 files
  still 400.

### Config (zod env schema, no magic numbers)

| Key                               | Default           | Meaning                                                                                          |
| --------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------ |
| ~~`DEAL_MAX_WATCHES`~~            | —                 | **Removed (D-dw-17)** → operator-editable `AppSettings.dealMaxWatches` (default 25, bounds 1–50) |
| `DEAL_REFRESH_INTERVAL_MS`        | 3 600 000         | Baseline re-check cadence (R3)                                                                   |
| `DEAL_REFRESH_JITTER_RATIO`       | 0.15              | Relative-scheduling jitter                                                                       |
| `DEAL_DRIFT_THRESHOLD`            | 0.20              | Drift vs capBaseline that triggers a cap re-derive (coarse pre-filter; D-dw-20)                  |
| `DEAL_MAX_ID_AGE_MS`              | 259 200 000 (3 d) | Forced re-derive age (pending P0.2/P0.8)                                                         |
| `DEAL_OUTLIER_RATIO`              | 0.5               | Listing < ratio × sample median = dropped (price-fixer)                                          |
| `DEAL_MIN_SAMPLE`                 | 5                 | Fewer usable listings → insufficient-data                                                        |
| `DEAL_MIN_HEADROOM`               | 0.15              | Deal-work budget reserve — low tier, wins over background market (D-dw-18)                       |
| `DEAL_BASELINE_STALE_MS`          | 10 800 000        | Baseline older than 3 h → stale status                                                           |
| `DEAL_REDERIVE_DEBOUNCE_MS`       | 5 000             | Threshold-edit re-derive debounce                                                                |
| `DEAL_MANUAL_REFRESH_COOLDOWN_MS` | 60 000            | Manual refresh per-search cooldown                                                               |
| `DEAL_CAP_MARGIN_RATIO`           | 0                 | Extra GGG-cap headroom above cutoff (Q3)                                                         |
| `DEAL_BASELINE_HISTORY_MAX`       | 500               | Rolling per-watch cap on baseline-history rows (D-dw-12)                                         |
| `DEAL_QUEUE_TICK_MS`              | 30 000            | Deal queue beat (due-refresh scan + queued-job pickup)                                           |
| `MARKET_CHECK_ENABLED`            | true              | Killswitch for the universal market-price loop (D-dw-14)                                         |
| `MARKET_CHECK_INTERVAL_MS`        | 10 800 000        | Market-price check cadence per active non-deal search — 3h (D-dw-14/18)                          |
| `MARKET_CHECK_MIN_HEADROOM`       | 0.5               | Market-loop budget reserve — high tier, yields to deals + detection (D-dw-18)                    |
| `MARKET_CHECK_JITTER_RATIO`       | 0.15              | Jitter on the market-check schedule                                                              |
| `MARKET_SNAPSHOT_REUSE_MS`        | 900 000           | Snapshot fresher than this seeds a deal enable for free (D-dw-14)                                |

### Failure modes (honest degradation, `DealWatchStatusCode`)

`active` · `paused` · `pending-derive` · `insufficient-data` · `baseline-stale` ·
`derive-failed` (POST rejected/rate-limited; retry via queue backoff; old cap keeps
running) · `derive-conflict` (returned id collides with another watched row) ·
`derived-expired` (id-invalid signals per P0.8 → recovery re-derive) ·
`unsupported-item` (stackable category, v1) · `capped` (over `dealMaxWatches`) ·
`restore-failed` (disable couldn't restore; row keeps last good state, operator
retries). Each code → i18n message EN+PL; raw GGG errors stay in logs (error-audit
rule).

## Rate-limit & human-behaviour budget

Per deal-mode search per hour, worst case: baseline refresh = **1 search-POST +
1 fetch**; a drift re-derive adds **+1 search-POST + 1 ws connect** (drip-paced). At
the 10-search cap: ≈ 20–30 requests/hour on the `search`/`fetch` policies — small
against the observed search policy ≈60:300:1800 and the 90 HTTP/min guard, and every
call passes governor + guard + the headroom reserve, so detection outranks deal-watch
on the shared budget by construction. ws connects are the tighter resource: all
deal-driven (re)connects ride the stagger drip inside the 12/min ceiling (D-dw-8).

v3 note: deal-mode searches are the operator's own rows — there is **no** extra
poll-rotation membership vs today (v2's dilution cost is gone). One honest cost
remains: a deal search whose ws is down detects with N×12 s poll latency, which is not
sniping-grade; the UI surfaces this state instead of pretending. A "priority poll slot
for deal searches" is parked.

## Testing (fixtures only, hard rule #8)

- Unit: baseline statistic (usable-listing rules, outlier drop, degenerate samples,
  median-of-min(K, survivors)), currency normalization (unknown currency, ApiId map),
  cutoff math both modes, drift-vs-capBaseline hysteresis, cap serialization,
  definition extraction / original-filter snapshot + restore, decorator (deal /
  deal-updated / stale-null / sub-threshold suppression), re-derive queue (coalescing,
  revalidation, collision no-op/conflict), enable/disable transforms, status
  transitions, manual-refresh cooldown, id-edit rejection while deal mode on.
- Integration (recorded fixtures from P0): enable → derive → swap → hit → `deal`
  event; re-derive keeps hit history/room/position; disable restores; import/export
  v4; boot re-queue of pending/expired.
- e2e: API surface against mock fixtures; web modal + deal rendering + DEAL row
  control.

## Phasing

- **Phase 0 — de-risk spike** (operator + assistant, ~an evening): P0.1–P0.9, evidence
  → api-notes.md, fixtures recorded. Gate per the fallback ladder above.
- **Phase 1 — server core**: migration 0011 (`searches.deal_watch`, `hits.deal`),
  market-data extraction (D-dw-3), governor `minHeadroom` helper, SearchManager
  `swapSearchId` seam (D-dw-7), deal-watch module (service, baseline, drift/re-derive
  queue, enable/disable transforms), decorator registry + `deal`/`deal-updated`
  events, PATCH/refresh endpoints, export v4. Verify green; unit tests land with the
  code.
- **Phase 2 — web**: DEAL row control + DealWatchModal, deal rendering in
  panel/hits/activity, edit-modal id lock, notification body/sound variant, i18n
  EN+PL.
- **Phase 3 — live validation** (operator): real deal-mode search on a liquid unique;
  baseline sanity vs the trade site; drift re-derive observed (id changes in the view,
  trade-site link stays fresh); disable/restore; first real deal alert. Results
  recorded in api-notes + the plan status line.
- **Parked**: per-unit normalization for stackables; resale tracker (bought-at vs
  sold-at P&L); trend guard ("don't buy a falling knife"); priority poll slot;
  suspicious-discount flag; tray/background notifications (90_future_ideas.md
  candidates); Activity-feed re-derive entry ("baseline X → Y ex, cap updated" —
  deferred from D-dw-12, see the as-built deviations).

## As-built deviations (recorded per the plan-24 pattern)

- **Live-validation finding (2026-07-05, first operator session): the baseline
  keeps the definition's OWN status instead of forcing `online`.** The plan's
  "force status online" step was wrong on live data: on identical uncapped
  constraints `online` returned 2 listings where the search's own `securable`
  returned 56 (Twister; operator's manual counter-search `4mmRQVvZt9`) —
  instant-buyout listings from offline sellers ARE the purchasable market.
  Evidence in api-notes; P0.9 closed with this semantics note. The #37
  price-check `online` usage is a parked follow-up.

### Phase 2 (2026-07-05)

- **D-dw-12 Activity-feed re-derive entry DEFERRED** — `rederived` samples are
  surfaced as ringed markers on the modal's trend sparkline only; the Activity
  feed entry is parked (see Parked). The history table + endpoint carry the
  `rederived` flag, so the feed entry is a pure web addition later.
- **Trend label is change-since-oldest-shown**, not D-dw-12's
  "change-since-yesterday" — the sparkline window (≤200 samples) is the honest
  reference span and avoids a second time anchor; accepted.

### Phase 1 (2026-07-05)

- **Pre-derive rows decorate as ordinary hits, not `deal`** — before the first
  successful swap the row still watches the operator's ORIGINAL query, so
  labelling those listings as deals would be wrong. "Never a bare hit" holds
  from the first derive onward.
- **`unsupported-item` gate deferred to Phase 2** — the stackable check needs a
  dictionary category lookup (`TradeDataService` is not exported from
  PriceCheckModule); the status code ships now, the gate lands with the UI
  warning. Until then the operator can enable deal mode on a stackable search
  and gets honest-but-wrong baselines — closed 2026-07-05 (W3: gate in
  `DealWatchService.enable`, 409 `deal-unsupported-item`, offline-tolerant).
- **Insufficient-data at refresh keeps the old baseline+cap running** (alerts
  continue, status flags the condition); only enable-time insufficiency skips
  the derive entirely.
- **`enable` is synchronous through the queue** — the PATCH answers after the
  first baseline+derive round trip with the real resulting status.
- **Cap floor**: `max(1, round(cutoff))` exalted so sub-1ex cutoffs still POST
  a valid cap.

## Decisions

- **D-dw-21 (operator, 2026-07-10, live incident)** — currency rates move from
  poe2scout to **GGG's own bulk Currency Exchange**. poe2scout's API vanished
  (every route 404 — evidence in api-notes) which silently nulled
  `divinePriceExalted`: the UI fell back to exalted-only display even for
  divine-unit thresholds — the operator-reported bug. The operator chose the
  GGG-native source over chasing poe2scout's new API ("czy musimy korzystać z
  poe scout? Nie możemy opierać się wyłącznie na poe2 trade oficjalnym od
  GGG?"). Implementation: `TradeApiClient.exchangePost` (own governor policy
  `'exchange'` — GGG buckets it separately as `trade-exchange-request-limit`,
  probed) + `ExchangeRatesService` (market-data): per-league 15-min snapshot,
  3 POSTs/TTL (divine sell+buy sides, chaos buy side), STOCK-WEIGHTED median
  per side against the decoy-heavy book, divine = mean of both sides;
  best-effort nulls + last-good-snapshot on failure. The exchange policy is
  deliberately NOT in the DEAL/BASELINE headroom gates — it has its own GGG
  budget (governor-paced), detection never touches it, and gating it self-blocked
  the re-derive right after a fresh rate round (observed live, fixed same day).
  poe2scout stays only behind
  price-check name lookups (#37) until its new API surfaces (parked). Trade-off
  accepted: only divine/chaos normalize now — exotic-currency listings drop out
  of baselines as unpriceable (conservative direction).
- **D-dw-20 (operator, 2026-07-07, live incident)** — smooth re-derives + a
  per-watch refresh interval. Root cause found live: a manual "refresh market
  price" (or the hourly drift refresh) that moves the cap re-derives → swaps the
  GGG id → `stopEngines` + drip restart, which (a) flashed `pending`/degraded on
  a routine cap update, and (b) under a burst of re-derives the ws-connect rate
  hit 13/min and TRIPPED the guard (12/min ceiling) → ALL detection halted until
  a manual reset. Fixes:
  1. **Smooth swap**: a deal re-derive carries the previous engine status onto
     the new watcher (no `pending`/degraded flash) — the near-identical capped
     query reconnects within seconds; only a genuine ws failure degrades.
  2. **Fewer re-derives**: `DEAL_DRIFT_THRESHOLD` raised 0.05 → **0.20**. The cap
     is a COARSE server-side pre-filter; the decorator already applies the exact
     cutoff against the live baseline, so a slightly-stale cap only lets a few
     sub-threshold listings through (suppressed), never a wrong alert. A wider
     drift band cuts ws-churn ~4× and keeps the ws-connect rate well under the
     guard ceiling. **Paired with `DEAL_CAP_MARGIN_RATIO` 0 → 0.25** (review S2):
     GGG returns only listings ≤ cap, so in a RISING market a stale cap set below
     the growing live cutoff would filter genuine deals out server-side before
     the decorator sees them — the margin (≥ the drift band) keeps the cap above
     the live cutoff across the whole tolerated drift, and the decorator
     suppresses the extra sub-cutoff listings it admits.
  3. **Guard-halt honesty** (review S2): `windDownForGuard` degrades every
     intended-running watcher on a guard trip, including one transiently
     engine-null mid-swap — so a preserved `active` can never outlive detection
     through a guard lockout.
  4. **Per-watch interval (feature)**: `dealWatch.refreshIntervalMs` overrides
     the global `DEAL_REFRESH_INTERVAL_MS` for how often that watch re-checks its
     market price (feeds the threshold cutoff). Operator picks from a small enum
     (e.g. 30 m / 1 h / 3 h / 6 h / 12 h) in the deal card; default = the global.
- **D-dw-19 (operator, 2026-07-05)** — rate-limit aggressiveness slider. A new
  `AppSettings.rateLimitAggressiveness` (**50–120, default 85**, Settings-view
  slider) = target utilization as a % of GGG's ADVERTISED limits (the governor
  learns those from `X-Rate-Limit-*` headers; never hardcoded). It scales the
  governor's effective ceiling: `effectiveLimit(bucket) = cap × A/100`; the
  near-limit hold triggers at `effectiveLimit` instead of `cap−1`, and
  `headroom` is computed against `effectiveLimit`, so the D-dw-18 reserves stay
  consistent. The `OutboundGuard` HTTP ceiling scales with A too (so 85–100%
  doesn't trip it spuriously). **>100% is an explicit RISK ZONE** (UI-warned):
  it deliberately runs past GGG's advertised cap → 429s → the governor's
  `pauseAll` (Retry-After) → ALL detection pauses; lockouts stack and it breaks
  the browser-mimicry rule (R7). Operator chose the 50–120 range knowingly;
  ≤100% is the safe, recommended band. Builds ON TOP of D-dw-18 (the reserves
  are the default operating point; the slider moves the whole ceiling).
- **D-dw-18 (operator, 2026-07-05, live incident)** — budget-priority tiers.
  Root cause found live: the universal market-price loop (D-dw-14, ~19 hourly
  checks) + the deal loop + detection over-subscribed the search policy;
  steady-state headroom (~0.27, pinned by the tight Account 3:5:60 / Ip 15:60
  rules) sat below the single `DEAL_MIN_HEADROOM=0.3` reserve, so EVERY deal
  derive and market check was declined — enables hung forever in
  `pending-derive` and all watches drifted `baseline-stale`. Fix: split the one
  reserve into tiers so background market work yields to operator-facing deal
  work and both yield to detection:
  - `DEAL_MIN_HEADROOM` lowered to **0.15** — deal derive/refresh is
    operator-facing and time-sensitive; it wins budget over background.
  - new `MARKET_CHECK_MIN_HEADROOM` = **0.5** — the universal market-price loop
    only runs with ample spare, yielding to detection AND deals.
  - `MARKET_CHECK_INTERVAL_MS` default raised 1h → **3h** (the 19-search sweep
    is heavy; the price is a rough reference, not live-critical).
    Detection keeps absolute priority (it never gates on a reserve; the governor's
    near-limit hold + 429 pause are the hard protections). Confirmed live:
    disabling the market loop lifted headroom 0.27→0.67 and both stuck enables
    derived immediately.
- **D-dw-17 (operator, 2026-07-05)** — the concurrent-deal-watch cap becomes an
  operator-editable setting (`AppSettings.dealMaxWatches`), surfaced in the
  Settings view, replacing the env-only `DEAL_MAX_WATCHES`. Default raised to 25
  (the hourly market query is cheap and scales to dozens; the real constraint is
  concurrent GGG `/live` sockets, whose tolerance is unprobed — P0.6). Input
  bounded to `DEAL_MAX_WATCHES_MAX = 50` with a UI note that a high cap risks
  GGG rate-limiting the live sockets, and that poll coverage still catches deals
  if a socket is 1013'd (graceful degradation). Raising the cap re-scans and
  resumes parked `capped` watches WITHOUT a restart; lowering it never
  force-parks already-armed watches (enforced on new enables + boot, as today).
- **D-dw-16 (operator, 2026-07-05)** — deal config can be set AT ADD TIME. The
  add-search form gains an optional deal section (mode + threshold value + unit
  - sample size); on submit the server creates the search then applies the deal
    config atomically in the same request (`POST /api/searches` accepts an
    optional `dealWatch`, controller calls `add()` → `DealWatchService.applyConfig`
    on the new id, returning the enabled runtime info). Other settings stay
    post-create as today; a blank deal section = add behaves exactly as before.
- **D-dw-1 (v3, operator, 2026-07-05)** — Deal mode is an in-place transform of the
  search itself: one row, system-managed id auto-updated in the view (supersedes v2's
  parent+hidden-shadow composition; kills the visibility architecture and the
  offer-race rule). Original price filter snapshotted and restored on disable.
- **D-dw-2 (operator-confirmed)** — Baseline is price-fixer-resistant (median of
  cheapest K usable survivors after outlier drop), never the raw lowest; raw lowest
  shown in UI.
- **D-dw-3** — Normalization in exalted via a new exported market-data module
  (Poe2ScoutClient moves + learns ApiId/DivinePrice); no GGG exchange endpoint (none
  evidenced).
- **D-dw-4 (v3)** — Deal config lives in a nullable `searches.deal_watch` JSON column
  (1:1 lifecycle with the row, carried through id swaps; API = search PATCH).
- **D-dw-5** — Deal alerts are a new `deal` DomainEvent (+ `deal-updated` twin),
  enriched at persistence time via a self-registering decorator registry; travel/buy
  gate on the search's own opt-in flags (hard rule 5).
- **D-dw-6 (updated post-P0.4, 2026-07-05)** — the GGG cap is expressed as
  `trade_filters.price = {max: round(cutoffExalted)}` with **no currency
  `option`**: absent option = GGG value-converts every listing currency to the
  league base (exalted) server-side, so one cap covers the whole market
  (evidence: api-notes 2026-07-05). Caps WITH an option are currency-literal —
  never use them. Residual risk: GGG's internal conversion rate may differ
  slightly from poe2scout's (Q3 margin); barter-priced listings are excluded
  from converted caps (accepted — not flippable inventory anyway).
- **D-dw-7** — SearchManager grows a minimal `swapSearchId` seam extracted from
  `editSearch`, collision-tolerant, used only by the deal-watch module; manual id
  edits are rejected while deal mode is on.
- **D-dw-8** — All deal-driven ws (re)starts ride the stagger drip; re-derives run
  through one global serialized, coalescing, post-await-revalidating queue.
- **D-dw-10** — Export v4 carries deal config only (no runtime state); imports
  re-derive fresh.
- **D-dw-11 (operator, 2026-07-05)** — pricing unit: all internal math and the GGG
  cap are in **exalted equivalent** (canonical unit; matches the no-option
  converted cap); each watch has a `unit: 'exalted' | 'divine'` (enum, default
  `'exalted'`) that drives display AND the absolute-threshold interpretation
  ("5 div taniej" = unit `divine`, converted via the live DivinePrice rate).
  This replaces the earlier free-form `thresholdCurrency` (and its `divine`
  default) — a two-value enum, not an arbitrary currency string. As-built type
  names (supersede the earlier data-model sketch): `unit`, `capExalted`,
  `rawLowestExalted`, `DealWatchState` in `packages/shared/src/deal-watch.ts`;
  the whole state lives in the nullable `searches.deal_watch` JSON column
  (migration 0011, together with the `hits.deal` JSON column).
- **D-dw-13 (operator, 2026-07-05, live-validation session)** — deal mode
  samples and watches ONLY the instant-buyout market: `status
{option:'securable'}` is forced onto both the baseline query and the watched
  capped query, whatever the definition carries. Rationale: non-instant
  listings are where manipulators park fake lowballs they never honor (they
  would poison the baseline), and a deal must be instantly buyable to flip.
  The stored definition keeps the ORIGINAL status untouched — disable restores
  faithfully. (Supersedes both "force online" — starved samples, 2 vs 56 — and
  the brief "inherit definition status" fix from earlier the same day.)
- **D-dw-14 (operator, 2026-07-05 — "rób A")** — universal market price: EVERY
  enabled, non-archived search gets an hourly-ish market check (the same robust
  baseline as deal mode; `stripPriceFilter` + the D-dw-13 instant-buyout
  status), persisted as a lightweight `searches.market_price` snapshot
  (migration 0013) and served on `SearchRuntimeInfo.marketPrice` — deal rows
  compose it from their own baseline instead (no double traffic). Traffic:
  ~2 req/h per search, at most ONE check per queue beat (a resume burst
  self-paces), same headroom reserve / pause / guard gating as deal refreshes —
  detection always outranks it; the shared stackable gate skips stack-priced
  items. A snapshot fresher than `MARKET_SNAPSHOT_REUSE_MS` seeds a deal enable
  for free, and disabling a deal hands its last baseline back as the market
  snapshot. Runtime-only state: never exported, cleared on id re-points;
  `MARKET_CHECK_ENABLED` is the killswitch.
- **D-dw-15 (operator, 2026-07-05)** — the baseline sample size is a per-watch
  knob (`DealWatchConfig.baselineSampleSize`, valid 3..20, default 10):
  base price = median of the N cheapest usable survivors after the outlier
  drop, and N is also the fetch depth. Thin markets set ~5, liquid ones 10–20.
  Supersedes the fixed `DEAL_BASELINE_K` (removed). The insufficiency floor
  drops to `min(DEAL_MIN_SAMPLE, N)` so a deliberately small N works on a thin
  market. Fetch depth > 10 chunks into ≤10-id `/fetch` calls (api-notes cap).
  The universal market-price loop (D-dw-14, non-deal rows) uses the default 10.
  A sample-size edit is picked up by the next scheduled refresh — never an
  immediate GGG spend. Config travels in export/import (older files default to
  10).
- **D-dw-12 (operator request, 2026-07-05)** — baseline price history: every
  successful baseline refresh appends one row to a `deal_baseline_history`
  table (migration 0012: `watch_id`, `amount_exalted`, `raw_lowest_exalted`,
  `sample_size`, `rederived` flag, `computed_at`; index on
  `(watch_id, computed_at)`), keyed by a stable `watchId` uuid inside the deal
  config — the search's GGG id churns on re-derive, so history must NOT key on
  it. Retention: `DEAL_BASELINE_HISTORY_MAX` newest rows per watch (default
  500 ≈ 3 weeks hourly), hits-style pruning; history is deleted when the watch
  is disabled/removed. Surfaces: a trend section in the DealWatchModal
  (sparkline + change-since-yesterday) and, in the Activity feed, an entry only
  for re-derive events ("baseline 520 → 490 ex, cap updated") — hourly no-op
  checks never spam the feed (Phase 2 renders both; Phase 1 ships table +
  writes + `GET /api/searches/:id/deal-history`).

## Open questions

- **Q3 — Cap margin.** If P0.4 shows GGG cross-currency conversion is coarse or drifts
  vs poe2scout, a small `DEAL_CAP_MARGIN_RATIO` (e.g. 0.05) avoids missing borderline
  deals at the cost of sub-threshold hits (suppressed, history-only).
- **Q4 — Scale.** RESOLVED by D-dw-17: the cap is now the operator-editable
  `AppSettings.dealMaxWatches` (default 25, bounds 1–50) — the operator tunes it
  live; the binding constraint is concurrent `/live` sockets (P0.6, still
  unprobed numerically), not the query budget.

Resolved: Q1 → D-dw-2 (median, operator-confirmed 2026-07-05); Q2 → D-dw-1 v3 (merged
single-search model, operator decision 2026-07-05).
