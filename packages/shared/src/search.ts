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
   * Overrides the query's `status.option` when set; null keeps the resolved
   * query's own status. Auto-travel only ever fires on securable hits — they
   * alone carry a hideout token.
   */
  purchaseMode: PurchaseMode | null;
  /** Raw trade query JSON (opaque payload, persisted as a JSON column). */
  filters: unknown;
  /** ISO-8601 timestamp of when the search was added. */
  addedAt: string;
}

/** One entry of the trade-site league list (id = the URL league segment). */
export interface LeagueInfo {
  id: string;
  text: string;
}

/** Engine currently serving a search's detection. */
export type EngineKind = 'ws' | 'poll';

export type EngineStatus = 'pending' | 'connecting' | 'active' | 'degraded' | 'stopped';

/** A managed search plus its live detection state (GET /api/searches). */
export interface SearchRuntimeInfo extends ManagedSearch {
  engine: EngineKind | null;
  status: EngineStatus;
  statusDetail: string | null;
  hitCount: number;
  lastHitAt: string | null;
}
