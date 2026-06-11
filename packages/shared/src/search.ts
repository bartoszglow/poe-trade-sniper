/** Trade realm as used in pathofexile.com trade2 URLs. */
export type Realm = 'poe2';

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
  /** Raw trade query JSON (opaque payload, persisted as a JSON column). */
  filters: unknown;
  /** ISO-8601 timestamp of when the search was added. */
  addedAt: string;
}

/** Engine currently serving a search's detection. */
export type EngineKind = 'ws' | 'poll';

export type EngineStatus = 'connecting' | 'active' | 'degraded' | 'stopped';
