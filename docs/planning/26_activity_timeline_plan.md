# 26 — Activity / Actions timeline

**Decision (approved 2026-06-25):** an operator-facing **Activity timeline** — a
server-persisted, chronological log of what the app DID. Each travel attempt is one
**activity** containing its atomic **steps** (travel → buy → return-to-hideout) with
timing, outcome and the full item context. **Read-only v1.** Cards with an
**expandable item-detail** section.

## Why / building blocks (already exist)

- `TravelEvent` (queued|started|success|failed, source auto|manual) and
  `BuyAutomationEvent` (started|window-found|item-located|moved|aborted|failed|unsupported,
  `detail` = reason) both carry `searchId`+`listingId`+`at`, published on the RealtimeBus → SSE.
- Item context (name, price, seller, rarity, mods, ilvl, corrupted) is the `Listing`/`Hit`,
  persisted in the `hits` table.
- Precedents: `/api/hits` (paginated history, `SearchManager.listHits`) + `NetworkPage`
  (server snapshot + client live-buffer from SSE). `EventStreamProvider` already buffers
  travel/buy state per listingId.

## Gaps filled by this feature

1. **return-to-hideout emits no events** → add `returning` / `returned` / `return-failed`
   phases to `BuyAutomationEvent`; `returnToHideout` emits them.
2. **no grouping** → `ActivityService` correlates travel→buy→return by `listingId`
   (one open record per listing; a new travel-started for a listing finalizes the prior).
   The single `BuySessionLock` guarantees no concurrent buys, so listingId keying is safe.
   (Threading a `correlationId` to also link the GGG network calls = v2.)
3. **no persistence** → new `activity` table (steps as JSON, item snapshot like `hits.item`).

## Data model

`ActivityRecord`: `id`, `searchId`, `listingId`, `source`, item snapshot (`itemName`,
`price`, `seller`, `item` ItemDetail JSON), `startedAt`, `finishedAt`, `outcome`
(`bought|item-sold|trade-window-not-found|travel-failed|buy-failed|returned|aborted|in-progress`),
`steps[]` = `{ kind: 'travel'|'buy'|'return', phase, at, detail }`.

## Build

- **shared:** `BuyAutomationEvent` += return phases; new `activity.ts`
  (`ActivityRecord`, `ActivityStep`, `ActivityOutcome`).
- **server:** `activity` table + migration; `ActivityService` (bus subscriber → upsert
  records, snapshot item from `hits`); `ActivityController` `GET /api/activity`
  (paginated+filtered, mirrors `/api/hits`); `returnToHideout` emits return events.
- **web:** `ActivityPage` + nav tab; an activity hook (fetch `/api/activity` +
  live-update from SSE travel/buy/return); timeline cards reusing
  `HitCard`/`ItemDetailView`/`PriceTag`/`Badge`, expandable item details; EN/PL i18n.
- **privacy:** never persist/expose the session or hideout token (hard rule #3).

## Status

- 2026-06-25: planned + approved + **IMPLEMENTED (read-only v1)**. Server: `activity`
  table + migration 0006, `ActivityService` (bus → records), `GET /api/activity`,
  BuyAutomationService emits returning/returned/return-failed. Web: `ActivityPage` +
  `ActivityCard` (expandable item details) + nav entry + `activityVersion` live refetch.
  Tests: ActivityService (full flow + item-sold/travel-failed). verify green (server 149).
- v2 parking lot: interactive actions (retry/jump-to-search), `correlationId` linking to
  the GGG network calls, per-step durations, server-side filters in the UI.
