# 29 — Search reorder (drag-and-drop) + highlight-on-hit

**Status: IMPLEMENTED** (`ccda160`, 2026-06-30). verify green (server 179, web 13, desktop 6).

## Reorder

Drag rows on the Searches view to set your own order. **That order is the single source of
truth** for both the displayed list AND the round-robin poll rotation — they're the same
thing because the scheduler iterates the watchers Map in insertion order, and reorder
rebuilds the Map in your order. So your top searches poll a tick earlier each cycle (a mild
detection-latency edge during poll-fallback windows; with the live WS connected each search
has its own socket, so order is then purely display).

**Explicitly NOT** wired to auto-travel/buy priority: the `BuySessionLock` (one buy at a
time) stays first-come FIFO. Reordering never destabilises the load-bearing buy path; the
manual **Buy** button already gives per-hit urgency. (Mapping judged buy-priority a "false
optimization" — hits rarely contend the lock in the same instant.)

- **server:** nullable `position` column (migration `0007_search_position`); bootstrap
  `orderBy(COALESCE(position, MAX_SAFE_INTEGER), addedAt)`; `SearchManager.reorder(ids)` —
  one transaction writing `position = index`, then a Map rebuild. Race-tolerant: ids that
  no longer exist are skipped, and any search not mentioned (added since the client
  fetched) is appended so nothing is dropped. `POST /api/searches/reorder { order }`.
  New searches keep `position = null` → sink to the end via the addedAt tiebreak. `position`
  is a DB-only ordering column (not on `ManagedSearch`/`SearchRuntimeInfo`).
- **web:** `@dnd-kit` (core/sortable/utilities) — accessible (keyboard + touch), a grip
  handle so dragging never fights the row's switches/buttons. Optimistic `arrayMove` (local
  `items` re-synced from the server during render, not in an effect) → reorder API →
  `searches-changed` SSE refetch reconciles. The old client-side rank-sort (enabled/
  autoTravel/newest) is **removed** — manual order wins (approved decision).

## Highlight-on-hit

When a **new** hit lands in live hits, its search row glows (gold border/tint) for ~60s,
then fades. `EventStreamProvider` tracks `lastHitAtBySearchId` (stamped on `hit`, NOT on a
`hit-updated` re-serve — a re-serve isn't a new finding); `SearchesPage` ages it out on a 5s
tick (`HIGHLIGHT_MS` = 60_000, `HIGHLIGHT_TICK_MS` = 5_000).

## Tests

`SearchManager.reorder` (order + persistence across a reload via the bootstrap orderBy;
race-tolerance). The DnD interaction + highlight are visual (operator view, mockup-exempt).
