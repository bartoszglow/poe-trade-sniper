# 35 — Search archive / restore (Searches view)

**Status: IMPLEMENTED** — `347f6c5`, 2026-07-02. Verify green (server 209, web 44,
desktop 6). Shipped after an adversarial lifecycle review (2 defects fixed pre-commit +
1 inherited race hardened).

Besides deleting, a search can be **archived**: it drops out of the workflow but keeps
everything, and can be restored or deleted later.

## Semantics (decisions)

- **Archive keeps everything**: hit history, the enabled/TRAVEL/BUY flags, and the room
  membership — restore puts the search back exactly where and how it was. If its room was
  deleted while archived, the member is released to the top level.
- **Detection stops immediately** on archive (engines torn down, status `stopped`, detail
  `archived`); archived searches are excluded from the layout/rooms, the DnD, the
  scheduler, the stagger drip, the room master switch, and global-pause relabeling.
- **UI**: Archive icon-button on every active row (no confirm — it's reversible); a greyed
  flat **"Archived (N)"** section at the bottom, sorted newest-archived first, each row
  with restore + delete (3s confirm). The click-to-locate spotlight can target archived
  rows. `archived_at` (ISO, migration `0009`) doubles as flag and sort key.
- **`delete-searches` on a room RELEASES its archived members** instead of deleting them —
  they are invisible in the room's UI, so destroying them silently would be a trap.
- **Export v3** carries `archivedAt`; older envelopes import as active; archived imports
  stay stopped. API: `PATCH /api/searches/:id { archived: boolean }`.

## Review findings fixed pre-commit

- Restore-while-globally-paused of a _disabled_ search wore a permanent `paused` badge
  after resume — the restore branch now checks `enabled` before the pause label.
- Restore never re-persisted `position`, so the restored slot reshuffled on restart —
  restore now re-persists the canonical layout in one transaction.
- Hardening (pre-existing race): a poll tick resolving after `stop()` could relabel a
  stopped/archived watcher — `tick()` now re-checks `running` after the awaited search.
