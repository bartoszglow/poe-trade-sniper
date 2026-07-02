/**
 * Variant-2 auto-expand for rooms (#33 follow-up, D-room-3): a room the
 * operator keeps collapsed pops open VISUALLY while a member's hit highlight
 * is fresh (~60s), and folds back once it ages out. Manually collapsing it
 * mid-window suppresses the auto-expand until that window fully expires — a
 * later NEW hit (fresh window) auto-expands again.
 *
 * The persisted `collapsed` flag is never touched by any of this — the
 * override is client-side presentation only, so a hit burst causes no server
 * writes and the operator's saved layout survives restarts unchanged.
 */

/** The visual collapse state of one room, given its highlight window. */
export function isRoomVisuallyCollapsed(options: {
  /** The operator's persisted preference (server-side `room.collapsed`). */
  persistedCollapsed: boolean;
  /** Any member search has a fresh hit highlight right now. */
  hasFreshHit: boolean;
  /** The operator manually collapsed this room during the current window. */
  suppressed: boolean;
}): boolean {
  if (!options.persistedCollapsed) return false;
  return !options.hasFreshHit || options.suppressed;
}

/**
 * Suppression ends with the window: drop every suppressed room whose fresh-hit
 * window has fully aged out. Returns null when nothing changed, so callers
 * using the adjust-during-render pattern can avoid a redundant setState.
 */
export function pruneSuppressedRooms(
  suppressedRoomIds: ReadonlySet<string>,
  freshRoomIds: ReadonlySet<string>,
): ReadonlySet<string> | null {
  const surviving = [...suppressedRoomIds].filter((roomId) => freshRoomIds.has(roomId));
  return surviving.length === suppressedRoomIds.size ? null : new Set(surviving);
}

/**
 * Session-scoped suppression store. The highlight window it is scoped to
 * (lastHitAtBySearchId) lives in the app-root EventStreamProvider and survives
 * route changes — a page-local useState would forget a manual mid-window
 * collapse on navigate-away-and-back and pop the room open again. This module
 * set has the same lifetime as that window state: survives route changes, dies
 * on reload. The page mirrors it into React state for re-renders.
 */
const suppressedRoomIdsStore = new Set<string>();

export function readSuppressedRoomIds(): ReadonlySet<string> {
  return new Set(suppressedRoomIdsStore);
}

export function suppressRoomAutoExpand(roomId: string): ReadonlySet<string> {
  suppressedRoomIdsStore.add(roomId);
  return new Set(suppressedRoomIdsStore);
}

/** Sync the store to a pruned snapshot computed by pruneSuppressedRooms. */
export function writeSuppressedRoomIds(suppressedRoomIds: ReadonlySet<string>): void {
  suppressedRoomIdsStore.clear();
  for (const roomId of suppressedRoomIds) suppressedRoomIdsStore.add(roomId);
}
