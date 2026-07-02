# 33 — Rooms: named groups of searches (Searches view)

**Status: ALL PHASES DONE** — `dc821b6` (1: server) + `bcf9a55` (2: web UI) + `e24d207`
(3: drag polish), 2026-07-02. Verify green (server 202, web 26, desktop 6). Phase 1
live-checked against the dev desktop (rooms CRUD + layout reorder + mode-less delete → 400).
Phase 2 shipped `RoomSection` (collapse persisted, inline rename, auto-rename on create,
member-count badge, delete-choice dialog per D-room-2, empty-room drop zone, collapsed-room
hit highlight), the pure DnD layout algebra in `apps/web/src/lib/search-layout-dnd.ts`
(13 unit tests), and the multi-container DnD (pointerWithin + closestCorners; drop on a room
header appends, works collapsed). Phase 3 added `DragOverlay` ghosts (search + room, never
clipped; source dims), `MeasuringStrategy.Always` (rooms resize mid-drag), and compact-rooms
mode while dragging a room block. Further feel-tuning happens on operator feedback.
Planned 2026-07-01, approved in-session.

Named "rooms" group related searches (e.g. five helmet searches while shopping for a
helmet). Rooms reorder like searches, searches drag into / out of rooms. One level deep —
**no rooms inside rooms** (keeps the DnD tractable; matches the use case).

## Decisions (approved)

- **D-room-1** — room **master enable/disable switch**: parked at MVP, **implemented
  2026-07-02 (`f7a6d23`)** on request. Header ACTIVE switch: ON while ANY member detects; a
  click sets ALL members to the opposite state (overwrites individual toggles by design);
  disabled on empty rooms. `POST /api/rooms/:id/enabled` → `SearchManager.setRoomEnabled`:
  one transaction, disable stops engines immediately, enable resets members to PENDING and
  goes through the staggered drip — never N direct ws-connects. The "stagger story" that
  parked this originally: the drip gap is now **derived from the guard budget**
  (`max(DETECTION_STAGGER_MS, GUARD_WINDOW_MS / GUARD_MAX_WS_CONNECTS_PER_MINUTE × 1.2)` =
  6s with defaults) — at 500ms a single 13+-search enable would have tripped the safety
  guard by itself (found by adversarial review; the mismatch predated this feature and also
  affected global resume/bootstrap). Slower mass-starts show honestly as `pending` badges.
- **D-room-2** — **deleting a room asks the operator**: either delete all member searches
  with it, or release them to the top level (inserted where the room was). Never a silent
  default; the dialog carries both actions.
- **D-room-3** (added 2026-07-02, `0c8d94d`) — **a collapsed room auto-expands while a
  member's hit highlight is fresh** (~60s) and folds back when it ages out; the header keeps
  the gold glow for the whole window. Client-side visual override only — the persisted
  `collapsed` is NEVER written by a hit. Manually collapsing mid-window (either an
  auto-expanded room or a persisted-expanded one) suppresses the pop-open until the window
  fully expires; suppression lives in a session-scoped module store
  (`apps/web/src/lib/room-auto-expand.ts`) so route changes don't forget it. The highlight
  aging tick pauses while the operator is mid-interaction (drag in flight, or a form field
  focused) so a fold-back can't unmount an open edit modal or shift drop targets; freshness
  derives from the server-confirmed layout, not the optimistic drag preview. Shipped after
  a multi-agent adversarial review (8 confirmed findings fixed pre-commit); known cosmetic
  leftover: an open (unfocused) criteria panel inside a folding room still closes with it.

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
