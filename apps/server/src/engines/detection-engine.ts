import type { EngineKind, EngineStatus, Listing } from '@poe-sniper/shared';
import type { TradeSearchRef } from '../trade-api/trade-api.client.js';

export interface EngineContext {
  search: TradeSearchRef;
  /** Resolved (and purchase-mode-adjusted) trade query JSON. */
  query: unknown;
  /** Threads this search's detection through the logs. */
  correlationId: string;
}

export interface EngineCallbacks {
  onListings(listings: Listing[]): void;
  onStatus(status: EngineStatus, detail: string | null): void;
  /**
   * The engine gives up on itself (e.g. ws repeatedly unstable) and asks the
   * manager to switch the search to the next strategy in the registry.
   */
  onDemote(reason: string): void;
}

/**
 * The open/closed core: a detection strategy. Adding one = a new class in the
 * engine registry; the SearchManager never changes.
 */
export interface DetectionEngine {
  readonly kind: EngineKind;
  start(context: EngineContext, callbacks: EngineCallbacks): void;
  /** Idempotent; must tear down every socket and timer it owns. */
  stop(): void;
}
