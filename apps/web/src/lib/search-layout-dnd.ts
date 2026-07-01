import { arrayMove } from '@dnd-kit/sortable';
import type { SearchLayoutEntry } from '@poe-sniper/shared';

/**
 * Pure layout manipulation behind the Searches-view drag-and-drop (#33).
 * DnD ids: a search uses its own id; a room block sorts as `room:<id>` and its
 * empty-body drop zone registers as `roomdrop:<id>` (search ids are trade-site
 * slugs, so the prefixes cannot collide).
 */
const ROOM_DRAG_PREFIX = 'room:';
const ROOM_DROP_PREFIX = 'roomdrop:';

export function roomDragId(roomId: string): string {
  return `${ROOM_DRAG_PREFIX}${roomId}`;
}

export function roomDropId(roomId: string): string {
  return `${ROOM_DROP_PREFIX}${roomId}`;
}

/** The room id when a DnD id addresses a room (drag handle or drop zone), else null. */
export function roomIdFromDndId(dndId: string): string | null {
  if (dndId.startsWith(ROOM_DRAG_PREFIX)) return dndId.slice(ROOM_DRAG_PREFIX.length);
  if (dndId.startsWith(ROOM_DROP_PREFIX)) return dndId.slice(ROOM_DROP_PREFIX.length);
  return null;
}

export interface SearchLocation {
  /** null = top level, else the containing room id. */
  roomId: string | null;
  /** Index within the container (top-level entries, or the room's members). */
  index: number;
}

export function locateSearch(layout: SearchLayoutEntry[], searchId: string): SearchLocation | null {
  for (const [topLevelIndex, entry] of layout.entries()) {
    if (entry.kind === 'search') {
      if (entry.id === searchId) return { roomId: null, index: topLevelIndex };
      continue;
    }
    const memberIndex = entry.searchIds.indexOf(searchId);
    if (memberIndex !== -1) return { roomId: entry.id, index: memberIndex };
  }
  return null;
}

/**
 * The top-level slot a DnD target belongs to: a room block (or anything inside
 * it) resolves to the room's slot, an ungrouped search to its own. -1 = unknown.
 */
export function topLevelIndexOf(layout: SearchLayoutEntry[], dndId: string): number {
  const targetRoomId = roomIdFromDndId(dndId);
  return layout.findIndex((entry) =>
    entry.kind === 'room'
      ? entry.id === targetRoomId || entry.searchIds.includes(dndId)
      : entry.id === dndId,
  );
}

const clampIndex = (index: number, length: number): number => Math.min(Math.max(index, 0), length);

/** Immutably move a search into a container slot (cross-container drag preview). */
export function moveSearch(
  layout: SearchLayoutEntry[],
  searchId: string,
  target: SearchLocation,
): SearchLayoutEntry[] {
  const withoutSearch = layout
    .filter((entry) => !(entry.kind === 'search' && entry.id === searchId))
    .map((entry) =>
      entry.kind === 'room' && entry.searchIds.includes(searchId)
        ? { ...entry, searchIds: entry.searchIds.filter((memberId) => memberId !== searchId) }
        : entry,
    );
  if (target.roomId === null) {
    const nextLayout = [...withoutSearch];
    nextLayout.splice(clampIndex(target.index, nextLayout.length), 0, {
      kind: 'search',
      id: searchId,
    });
    return nextLayout;
  }
  return withoutSearch.map((entry) => {
    if (entry.kind !== 'room' || entry.id !== target.roomId) return entry;
    const memberIds = [...entry.searchIds];
    memberIds.splice(clampIndex(target.index, memberIds.length), 0, searchId);
    return { ...entry, searchIds: memberIds };
  });
}

/** Same-container reorder on drop; a cross-container pair is left unchanged. */
export function reorderWithinContainer(
  layout: SearchLayoutEntry[],
  activeSearchId: string,
  overSearchId: string,
): SearchLayoutEntry[] {
  const activeLocation = locateSearch(layout, activeSearchId);
  const overLocation = locateSearch(layout, overSearchId);
  if (!activeLocation || !overLocation || activeLocation.roomId !== overLocation.roomId) {
    return layout;
  }
  if (activeLocation.roomId === null) {
    return arrayMove(layout, activeLocation.index, overLocation.index);
  }
  return layout.map((entry) =>
    entry.kind === 'room' && entry.id === activeLocation.roomId
      ? {
          ...entry,
          searchIds: arrayMove(entry.searchIds, activeLocation.index, overLocation.index),
        }
      : entry,
  );
}

/** Move a whole room block to the target's top-level slot. */
export function moveRoom(
  layout: SearchLayoutEntry[],
  movedRoomId: string,
  overDndId: string,
): SearchLayoutEntry[] {
  const fromIndex = layout.findIndex((entry) => entry.kind === 'room' && entry.id === movedRoomId);
  const toIndex = topLevelIndexOf(layout, overDndId);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return layout;
  return arrayMove(layout, fromIndex, toIndex);
}
