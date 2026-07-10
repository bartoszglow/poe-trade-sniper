import type { DealWatchState, MarketPriceSnapshot } from './deal-watch.js';

/** Trade realm as used in pathofexile.com trade2 URLs. */
export type Realm = 'poe2';

/**
 * Purchase type, mirroring the trade-site status dropdown. Maps to the trade
 * query's `status.option`; only `instant` (= `securable`) has a verified API
 * value so far — see docs/integration/api-notes.md. `null` on a search means
 * "keep whatever the resolved query already carries".
 */
export type PurchaseMode =
  | 'instant_and_in_person'
  | 'instant'
  | 'in_person_online_in_league'
  | 'in_person_online'
  | 'any';

export const PURCHASE_MODES: PurchaseMode[] = [
  'instant_and_in_person',
  'instant',
  'in_person_online_in_league',
  'in_person_online',
  'any',
];

/**
 * A watched trade search managed by the SearchManager.
 * `filters` holds the raw trade-site query JSON recovered via the resolve
 * endpoint — treated as opaque here; the trade-api adapter owns its shape.
 */
export interface ManagedSearch {
  /** The trade-site search id (the slug from the search URL). */
  id: string;
  realm: Realm;
  league: string;
  /** Operator-facing label shown in the UI. */
  label: string;
  /** When true, a detected hit triggers an automatic hideout travel. Explicit opt-in. */
  autoTravel: boolean;
  /**
   * When true, a successful AUTO travel triggers Buy automation (focus → capture
   * → locate → human-like move; no click). Requires `autoTravel` AND the macOS
   * `control` permission; Electron-only. Explicit opt-in.
   */
  autoBuy: boolean;
  /** Paused (false) searches stay listed and configured but run no detection. */
  enabled: boolean;
  /**
   * Overrides the query's `status.option` when set; null keeps the resolved
   * query's own status. Auto-travel only ever fires on securable hits — they
   * alone carry a hideout token.
   */
  purchaseMode: PurchaseMode | null;
  /** Raw trade query JSON (opaque payload, persisted as a JSON column). */
  filters: unknown;
  /** ISO-8601 timestamp of when the search was added. */
  addedAt: string;
  /** Room (named group) this search belongs to, or null = top level. */
  roomId: string | null;
  /**
   * ISO-8601 archive time, or null = active (#35). Archived searches run no
   * detection and leave the layout/rooms; membership and every toggle are kept
   * so a restore puts the search back exactly as it was.
   */
  archivedAt: string | null;
  /** Deal-watch state; null = ordinary search (plan 41, D-dw-4). */
  dealWatch: DealWatchState | null;
}

/** A named group of searches on the Searches view (one level deep — no nesting). */
export interface RoomInfo {
  id: string;
  name: string;
  /** Collapsed in the UI (persisted so it survives restarts). */
  collapsed: boolean;
  /** Room master switch: a gate on top of each member's own `enabled`. A member
   *  runs iff `member.enabled && room.enabled && !detectionPaused`. Toggling this
   *  never rewrites a member's individual enabled (single source of truth). */
  enabled: boolean;
  /** ISO-8601 timestamp of when the room was created. */
  addedAt: string;
}

/**
 * One top-level slot of the Searches view: an ungrouped search, or a room with
 * its members in order. The explicit tree is unambiguous even for empty rooms.
 */
export type SearchLayoutEntry =
  | { kind: 'search'; id: string }
  | { kind: 'room'; id: string; searchIds: string[] };

/** On room deletion the operator chooses; there is deliberately no default. */
export type RoomDeleteMode = 'release' | 'delete-searches';

/** One entry of the trade-site league list (id = the URL league segment). */
export interface LeagueInfo {
  id: string;
  text: string;
}

/**
 * One entry of the trade-site stat dictionary — maps an opaque query stat id
 * (`explicit.stat_3299347043`) to its human label (`+#% to Fire Resistance`).
 */
export interface StatDictionaryEntry {
  id: string;
  text: string;
  /** Stat group: explicit / implicit / rune / enchant / sanctum / … */
  type: string;
}

/** A resolved-but-not-watched search — the add-form criteria preview. */
export interface SearchPreview {
  id: string;
  realm: Realm;
  league: string;
  query: unknown;
}

/** Engine currently serving a search's detection. */
export type EngineKind = 'ws' | 'poll';

export type EngineStatus =
  | 'pending'
  | 'connecting'
  | 'active'
  | 'degraded'
  | 'stopped'
  /** Halted by the global detection pause (distinct from a per-search stop). */
  | 'paused';

/** A managed search plus its live detection state (GET /api/searches). */
export interface SearchRuntimeInfo extends ManagedSearch {
  engine: EngineKind | null;
  status: EngineStatus;
  statusDetail: string | null;
  hitCount: number;
  lastHitAt: string | null;
  /**
   * Approximate market price of the item (D-dw-14) — deal rows serve their
   * live baseline, ordinary rows the hourly market check. Runtime-only:
   * deliberately NOT on ManagedSearch, so exports never carry it.
   */
  marketPrice: MarketPriceSnapshot | null;
}

/**
 * The full Searches view (GET /api/searches and every rooms/reorder mutation).
 * `searches` is the flattened canonical order (rooms expanded in place) — the
 * same order the server's poll rotation walks; `layout` is the top-level tree
 * the UI renders.
 */
export interface SearchesView {
  searches: SearchRuntimeInfo[];
  rooms: RoomInfo[];
  layout: SearchLayoutEntry[];
}
