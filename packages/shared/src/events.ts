import type { Listing, EngineKind, EngineStatus, ManagedSearch } from './index.js';

/**
 * Closed union of realtime events published on the RealtimeBus and delivered
 * to the UI over SSE. Adding an event type = adding a member here; consumers
 * must switch exhaustively.
 */
export type DomainEvent = HitEvent | SearchesChangedEvent | EngineStatusEvent | LogEvent;

export interface HitEvent {
  type: 'hit';
  listing: Listing;
}

export interface SearchesChangedEvent {
  type: 'searches-changed';
  searches: ManagedSearch[];
}

export interface EngineStatusEvent {
  type: 'engine-status';
  searchId: string;
  engine: EngineKind;
  status: EngineStatus;
}

export interface LogEvent {
  type: 'log';
  level: 'info' | 'warn' | 'error';
  message: string;
  correlationId: string | null;
  at: string;
}
