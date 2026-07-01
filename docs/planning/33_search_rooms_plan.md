# 33 — Rooms: named groups of searches (Searches view)

**Status: PHASE 1 (server) DONE** — `dc821b6`, 2026-07-02. Verify green (server 202,
web 13, desktop 6); live-checked against the dev desktop (rooms CRUD + layout reorder +
mode-less delete → 400). Phase 2 (web UI) next, then Phase 3 (polish).
Planned 2026-07-01, approved in-session.

Named "rooms" group related searches (e.g. five helmet searches while shopping for a
helmet). Rooms reorder like searches, searches drag into / out of rooms. One level deep —
**no rooms inside rooms** (keeps the DnD tractable; matches the use case).

## Decisions (approved)

- **D-room-1** — room **master enable/disable switch is PARKED** (follow-up, see
  [90_future_ideas](90_future_ideas.md)). MVP ships rooms pure: create / rename / collapse /
  reorder / membership / delete.
- **D-room-2** — **deleting a room asks the operator**: either delete all member searches
  with it, or release them to the top level (inserted where the room was). Never a silent
  default; the dialog carries both actions.

## Canonical order — the load-bearing invariant

Flattened depth-first order (top-level items in order, each room expanded in place) **is**
the watchers Map order — same single source of truth as plan [29](29_search_reorder_and_highlight.md).
Poll round-robin, staggered detection-enable, pause/guard iteration, and export order keep
working with **zero changes**; they never learn rooms exist. Moving a room moves its
members' poll priority as a block. Buy priority stays untouched (FIFO `BuySessionLock`).

## Data model

- New `rooms` table: `id` (nanoid), `name` NOT NULL, `position` (top-level order),
  `collapsed` (bool, persisted), `added_at`.
- `searches.room_id` — nullable text. **No FK/cascade reliance** (SQLite `foreign_keys` is
  OFF in this app — known gotcha); delete re-homes or deletes members explicitly in code,
  inside the same transaction.
- **Two position scopes, plan-29 scheme** (full reindex, no fractional keys): the top-level
  sequence is shared by rooms and ungrouped searches; each room has its own 0..M member
  sequence. One reorder = one transaction rewriting both.

## API

- `POST /api/rooms` (create, name required), `PATCH /api/rooms/:id` (rename, collapsed),
  `DELETE /api/rooms/:id` with an explicit **`mode: 'release' | 'delete-searches'`** (D-room-2;
  no default — the client always sends the operator's choice). `release` inserts members at
  the room's top-level slot; `delete-searches` tears each member down through the normal
  search-removal path (watcher stop + cascade), one transaction.
- `POST /api/searches/reorder` payload becomes an explicit layout tree (replaces
  `{ order: string[] }`; single client, no back-compat shim):

  ```ts
  {
    layout: Array<
      { kind: 'search'; id: string } | { kind: 'room'; id: string; searchIds: string[] }
    >;
  }
  ```

  Race-tolerance as today: unknown ids skipped; unmentioned searches/rooms appended so
  nothing is dropped. The explicit tree is unambiguous even for empty rooms.

- `GET /api/searches` response gains `layout` + `rooms: RoomInfo[]`; `SearchRuntimeInfo`
  gains `roomId`. Types in `packages/shared` (no client/server drift).

## Web UI (`SearchesPage`)

- dnd-kit **multiple-containers pattern** on the existing setup: root `SortableContext`
  mixes `SearchRow`s and new `RoomSection`s; each room hosts its own `SortableContext` and
  is droppable. `onDragOver` previews cross-container moves; `onDragEnd` commits the whole
  layout optimistically and POSTs it (today's `arrayMove` + SSE-refetch flow, generalized).
- Room drag = header grip, moves the block among top-level slots only. Search drag lands
  between root items, inside an expanded room, or **onto a room header** (works collapsed =
  append). Empty rooms keep a visible drop zone.
- `RoomSection`: header grip, collapse chevron, inline-rename name, member-count badge,
  delete (opens the D-room-2 choice dialog); members rendered indented/framed.
- **Collapsed-room hit highlight**: if a hidden member hits, the room header takes the gold
  highlight (reuses `lastHitAtBySearchId` aging from plan 29).
- Keyboard/touch sensors carry over. Operator view → mockup-exempt, built directly.

## Ripple effects

- `SearchManager`: bootstrap hydration orders by (container top-level position, then
  within-container position); `reorder()` rebuilds the Map from the flattened layout.
  Scheduler/stagger/pause untouched.
- **Export/import** ([27](27_export_import_plan.md)): searches envelope version bump —
  rooms and memberships included; old envelopes import fine (all at root). Import creates
  missing rooms by name.

## Phases & tests

1. **Server** — migration, rooms CRUD, layout reorder + hydration; tests: layout → Map
   order, delete in both modes (release slot placement / member teardown), race cases,
   export/import round-trip with rooms.
2. **Web** — `RoomSection`, multi-container DnD, layout-reconstruction util (pure,
   unit-tested), optimistic commit, delete-choice dialog, i18n (EN+PL).
3. **Polish** — collapsed-room highlight, empty-room drop zone, drag interaction tuning.

Main risk: nested-DnD interaction polish (room-drag vs search-drag interplay) — budgeted
for iteration; the rest is mechanical.
