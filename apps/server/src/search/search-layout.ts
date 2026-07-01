import type { SearchLayoutEntry } from '@poe-sniper/shared';

/** Minimal search state the layout algebra needs: identity + membership. */
export interface LayoutSearchState {
  id: string;
  roomId: string | null;
}

/** Room state the layout algebra needs; `position` is the last persisted top-level index. */
export interface LayoutRoomState {
  id: string;
  position: number;
}

type RoomLayoutEntry = Extract<SearchLayoutEntry, { kind: 'room' }>;

/**
 * Derives the top-level layout tree from the flattened canonical order (#33).
 * Members are grouped onto their room at the room's FIRST member occurrence
 * (self-healing if memberships ever become non-contiguous, e.g. right after an
 * import appended members at the end); rooms with no member have nothing to
 * anchor them, so each is spliced back in at its last persisted top-level index.
 */
export function buildLayout(
  orderedSearches: LayoutSearchState[],
  orderedRooms: LayoutRoomState[],
): SearchLayoutEntry[] {
  const knownRoomIds = new Set(orderedRooms.map((room) => room.id));
  const entries: SearchLayoutEntry[] = [];
  const roomEntryById = new Map<string, RoomLayoutEntry>();
  for (const search of orderedSearches) {
    const roomId = search.roomId !== null && knownRoomIds.has(search.roomId) ? search.roomId : null;
    if (roomId === null) {
      entries.push({ kind: 'search', id: search.id });
      continue;
    }
    let roomEntry = roomEntryById.get(roomId);
    if (!roomEntry) {
      roomEntry = { kind: 'room', id: roomId, searchIds: [] };
      roomEntryById.set(roomId, roomEntry);
      entries.push(roomEntry);
    }
    roomEntry.searchIds.push(search.id);
  }
  const emptyRooms = orderedRooms
    .filter((room) => !roomEntryById.has(room.id))
    .sort((first, second) => first.position - second.position);
  for (const room of emptyRooms) {
    const index = Math.min(Math.max(room.position, 0), entries.length);
    entries.splice(index, 0, { kind: 'room', id: room.id, searchIds: [] });
  }
  return entries;
}

export interface NormalizedLayout {
  layout: SearchLayoutEntry[];
  /** Depth-first flattened (id + new membership) — the new canonical order. */
  flattened: LayoutSearchState[];
}

/**
 * Turns a client-submitted layout into a canonical one against current state —
 * the #29 race-tolerance rules extended to the tree. Duplicate and unknown ids
 * are dropped. A top-level search entry always means "no room". A room entry
 * whose room no longer exists keeps its surviving members inline at that spot,
 * top-level (release semantics — the room was deleted mid-drag). Afterwards,
 * unmentioned rooms are appended in their current order, then every unmentioned
 * search is appended — into its still-existing room if it has one, else to the
 * top level — so nothing is ever dropped.
 */
export function normalizeLayout(
  requested: SearchLayoutEntry[],
  currentSearches: LayoutSearchState[],
  currentRoomIds: string[],
): NormalizedLayout {
  const knownSearchIds = new Set(currentSearches.map((search) => search.id));
  const knownRoomIds = new Set(currentRoomIds);
  const seenSearchIds = new Set<string>();
  const seenRoomIds = new Set<string>();
  const layout: SearchLayoutEntry[] = [];

  const takeSearch = (searchId: string): boolean => {
    if (!knownSearchIds.has(searchId) || seenSearchIds.has(searchId)) return false;
    seenSearchIds.add(searchId);
    return true;
  };

  for (const entry of requested) {
    if (entry.kind === 'search') {
      if (takeSearch(entry.id)) layout.push({ kind: 'search', id: entry.id });
      continue;
    }
    if (!knownRoomIds.has(entry.id)) {
      for (const memberId of entry.searchIds) {
        if (takeSearch(memberId)) layout.push({ kind: 'search', id: memberId });
      }
      continue;
    }
    if (seenRoomIds.has(entry.id)) continue;
    seenRoomIds.add(entry.id);
    layout.push({ kind: 'room', id: entry.id, searchIds: entry.searchIds.filter(takeSearch) });
  }

  // Unmentioned rooms BEFORE unmentioned searches, so a member search that was
  // omitted still finds its room's entry to land in.
  for (const roomId of currentRoomIds) {
    if (seenRoomIds.has(roomId)) continue;
    seenRoomIds.add(roomId);
    layout.push({ kind: 'room', id: roomId, searchIds: [] });
  }
  const roomEntryById = new Map<string, RoomLayoutEntry>(
    layout.flatMap((entry) => (entry.kind === 'room' ? [[entry.id, entry] as const] : [])),
  );
  for (const search of currentSearches) {
    if (seenSearchIds.has(search.id)) continue;
    seenSearchIds.add(search.id);
    const roomEntry = search.roomId !== null ? roomEntryById.get(search.roomId) : undefined;
    if (roomEntry) roomEntry.searchIds.push(search.id);
    else layout.push({ kind: 'search', id: search.id });
  }

  const flattened: LayoutSearchState[] = [];
  for (const entry of layout) {
    if (entry.kind === 'search') {
      flattened.push({ id: entry.id, roomId: null });
    } else {
      for (const memberId of entry.searchIds) flattened.push({ id: memberId, roomId: entry.id });
    }
  }
  return { layout, flattened };
}
