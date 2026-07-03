# 39 — Activity view redesign: a unified feed (hits + price checks + auto-buy)

**Status: PLAN / mockup (2026-07-03).** Design-first — no implementation until the
direction (Q1/Q2 below) is picked. Mockup: `docs/mockups/activity-feed.html`
(desktop + mobile).

## Why

The Activity view today is a flat list of ONE event type — auto/manual travel→buy
runs (`ActivityRecord`, `/api/activity`). The operator wants it to be the app's single
**timeline of everything that happened**: live hits + price checks + the buy/travel
runs — and restyled to feel like the Searches view (cards, header with actions, clear
empty states) instead of the plain list it is now.

## The three sources (all already exist)

| Kind                  | Data                                            | Source                     | Live signal              |
| --------------------- | ----------------------------------------------- | -------------------------- | ------------------------ |
| **Hit** — a detection | `Hit`/`Listing` (item, price, seller, searchId) | `/api/hits` + SSE          | EventStream `hit` events |
| **Price check**       | `PriceCheckHistoryEntry` (result)               | `/api/price-check/history` | `usePriceCheck` history  |
| **Auto-buy / travel** | `ActivityRecord` (outcome + steps)              | `/api/activity`            | `activityVersion` bump   |

## Proposed design

A **single chronological feed** (newest first), styled with the Searches view's language:

- **Header** like Searches — `Activity` title on the left, a **filter-chip row** on the
  right. The chips are a WHITELIST of visible kinds (`[Hits] [Price checks] [Auto-buy]`),
  each a toggle — composable, not boolean-flag soup (matches the project's "visible
  sections" convention). Default: all on.
- **Feed cards** share ONE shell (the Searches card: `rounded-lg border border-edge
bg-surface-1 px-4 py-3`), differentiated by a **kind accent**: a left colour bar + a
  lucide icon (⚡ hit / 🪙 price check / 🛒 auto-buy) and a tone. Attractive + consistent.
- **Per-kind card body** via a renderer REGISTRY keyed by `kind` (open/closed — a new
  event kind = a new entry), reusing existing pieces: the hit card body (item + price +
  source-search chip + trade link), `PriceCheckResultView` (compact) for a price check,
  and the existing `ActivityCard` (outcome badge + expandable steps) for a buy/travel run.
- **Empty state** + relative "x ago" timestamps + click-to-locate the source search
  (reusing the spotlight store) — same idioms as the Live Hits panel.

### Data model

A discriminated union merged + sorted once:

```
FeedEntry =
  | { kind: 'hit';        at; hit: Hit }
  | { kind: 'price-check'; at; entry: PriceCheckHistoryEntry }
  | { kind: 'activity';   at; record: ActivityRecord }
```

`useActivityFeed()` fetches the three endpoints, maps to `FeedEntry[]`, merges by `at`
desc, caps the list, and re-merges on any of the three live signals. The dedicated Live
Hits panel and Price Checks view STAY — Activity is the unified read-only history.

### Decisions

- **D-act-1** ONE card shell + kind accent + renderer registry (consistency + open/closed).
- **D-act-2** filter chips as a visible-kinds whitelist (not per-kind booleans).
- **D-act-3** Activity is read-only history; it complements (doesn't replace) the Hits
  panel / Price Checks view.
- **D-act-4** cap the merged feed (e.g. 150 newest across kinds); hits dominate volume, so
  a cap keeps it a "recent timeline", not an audit dump.

## Progressive disclosure — two-level expand (operator request)

Every card is collapsed by default (the summary row). Expansion is TWO levels:

1. **Click the card → event/action details** (level 1) — the per-kind body we show
   today, rendered inside the card: hit → seller + indexed time + full price + source
   search + trade link (+ travel/whisper action); price check → `PriceCheckResultView`
   (estimate/listings + matched/unmatched stats); auto-buy → the `ActivityCard` outcome
   timeline + steps. If the entry carries an item, level 1 ends with an **"Item details"**
   sub-toggle.
2. **Click "Item details" → the item** (level 2) — the (restyled) `ItemDetailView`
   (properties / requirements / mods) nested under the event details.

So: one click reveals the action details, a second click (the nested toggle) reveals the
item mods — cheap items stay compact, deep dives are one extra click. A chevron shows the
level. State is per-card, local (like the current `ActivityCard.expanded`).

## Item details — extract + restyle

`ItemDetailView` is **already extracted** (`components/ItemDetailView.tsx`, used by
`ActivityCard` + `HitsPage`), so the feed reuses it — no new component. It currently
renders a `DetailCard` grid (Item / Properties / Requirements / Mods) with trade-site mod
colours (implicit faint-italic, explicit `rarity-magic` blue, rune gold, crafted info).

**Restyle to fit the app** (D-act-5): drop the heavy 3-col `DetailCard` grid inside a
feed card (it fights the card's own frame) for a **tighter, inline layout** — a compact
properties/requirements line + a **mods block** that reads like the game/trade tooltip:
one mod per line, value highlighted in gold, a subtle domain accent per group
(implicit italic-faint · explicit ink · rune gold · crafted info · fractured/enchant
distinct) with thin dividers, on a `surface-2` inset. Keep the standalone `HitsPage` use
working (the restyle is internal to `ItemDetailView`, so both surfaces benefit).

## Open questions (pick before build)

- **Q1 — layout.** (a) _Merged single stream_ + filter chips (recommended — truest
  "timeline", one scroll). (b) _Tabs_ (All / Hits / Price checks / Buys). (c) _Sections_
  per kind like Searches' rooms. Tradeoff: merged reads as one story but mixes event
  densities; tabs/sections separate cleanly but feel less like a unified feed. **Mockup
  shows (a).**
- **Q2 — scope of "hit".** All persisted hits, or only recent (cap)? And keep the source-
  search chip + click-to-locate? (Recommended: capped + chip, matching the Live Hits panel.)
