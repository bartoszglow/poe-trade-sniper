import type {
  Listing,
  DealHitInfo,
  EngineKind,
  EngineStatus,
  ManagedSearch,
  TravelFailureReason,
} from './index.js';

/**
 * Closed union of realtime events published on the RealtimeBus and delivered
 * to the UI over SSE. Adding an event type = adding a member here; consumers
 * must switch exhaustively.
 */
export type DomainEvent =
  | HitEvent
  | HitUpdatedEvent
  | DealEvent
  | DealUpdatedEvent
  | SearchesChangedEvent
  | EngineStatusEvent
  | TravelEvent
  | BuyAutomationEvent
  | GuardEvent
  | LogEvent
  | NetworkEvent;

/**
 * Safety-guard state change. `tripped` = the outbound watchdog detected
 * runaway behavior and halted ALL GGG traffic; operator must reset.
 */
export interface GuardEvent {
  type: 'guard';
  state: 'tripped' | 'reset';
  reason: string | null;
  at: string;
}

export interface HitEvent {
  type: 'hit';
  listing: Listing;
}

/**
 * The SAME offer as an existing live hit, re-served by GGG under a new listing id
 * (esp. after a travel re-query). The feed folds it onto the existing entity — newest
 * id, moved to the top — but auto-travel/auto-buy IGNORE it: only `hit` triggers
 * actions, so a re-serve can never re-travel or re-buy. Grouping is owned by the
 * LiveOfferRegistry, not by the action services.
 */
export interface HitUpdatedEvent {
  type: 'hit-updated';
  listing: Listing;
}

/**
 * A NEW hit on a deal-mode search (plan 41, D-dw-5): the `hit` counterpart
 * carrying the discount context computed against the live baseline at
 * persistence time. A deal-mode search emits `deal` INSTEAD of `hit` — even
 * with a missing baseline (null discount fields), never a bare `hit`.
 * Auto-travel/auto-buy subscribe to it under the search's own opt-in flags.
 */
export interface DealEvent {
  type: 'deal';
  listing: Listing;
  deal: DealHitInfo;
}

/**
 * The SAME deal offer re-served by GGG under a new listing id — the
 * `hit-updated` twin. Feed-only: the UI folds it onto the existing entity, but
 * it never re-triggers actions (travel/buy ignore it, exactly like
 * `hit-updated`).
 */
export interface DealUpdatedEvent {
  type: 'deal-updated';
  listing: Listing;
  deal: DealHitInfo;
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

/** Lifecycle of one hideout travel — the UI renders these as toasts. */
export interface TravelEvent {
  type: 'travel';
  phase: 'queued' | 'started' | 'success' | 'failed';
  source: 'manual' | 'auto';
  searchId: string | null;
  listingId: string | null;
  itemName: string | null;
  detail: string | null;
  /** Set only on `phase: 'failed'` — a stable reason the UI maps to a friendly label. */
  reason: TravelFailureReason | null;
  at: string;
}

/**
 * Lifecycle of one Buy automation run (Phase 2, Electron-only). Fires async off
 * a successful AUTO travel; ends at a human-like mouse MOVE (`moved`) — there is
 * no click yet. `unsupported` is emitted when the platform/capability can't run
 * it. The UI renders terminal phases as toasts/row status.
 */
export interface BuyAutomationEvent {
  type: 'buy';
  phase:
    | 'started'
    | 'window-found'
    | 'item-located'
    | 'moved'
    // Return-to-hideout (after the buy outcome): typing the `/hideout` chat command.
    | 'returning'
    | 'returned'
    | 'return-failed'
    | 'aborted'
    | 'failed'
    | 'unsupported';
  searchId: string | null;
  listingId: string | null;
  itemName: string | null;
  detail: string | null;
  at: string;
}

export interface LogEvent {
  type: 'log';
  level: 'info' | 'warn' | 'error';
  message: string;
  correlationId: string | null;
  at: string;
}

/** HTTP request to GGG, or a live-socket lifecycle/frame. */
export type NetworkChannel = 'http' | 'ws';

/**
 * Outcome bucket for one network entry — drives the row color in the dev view.
 * `ok` 2xx; `client-error` 4xx; `server-error` 5xx; `rate-limited` 429.
 */
export type NetworkOutcome =
  | 'ok'
  | 'client-error'
  | 'server-error'
  | 'rate-limited'
  | 'guard-blocked'
  | 'no-session'
  | 'timeout'
  | 'network-error'
  | 'ws-connecting'
  | 'ws-open'
  | 'ws-closed'
  | 'ws-frame';

/**
 * One observable interaction with GGG, REDACTED of all secrets (never a
 * cookie, User-Agent, or hideout token — only the safe URL, status, timing and
 * X-Rate-Limit headers). The dev "Network" view and the on-disk log both
 * render these.
 */
export interface NetworkLogEntry {
  id: string;
  /** ISO-8601 start time. */
  at: string;
  channel: NetworkChannel;
  /** GET / POST for http; WS for sockets. */
  method: string;
  /** Safe URL (our GGG URLs carry only search/league/listing ids). */
  url: string;
  /** Rate-limit policy key for http calls (search/fetch/whisper/…). */
  policy: string | null;
  correlationId: string | null;
  /** HTTP status, or the ws close code; null while pending / not applicable. */
  status: number | null;
  durationMs: number | null;
  outcome: NetworkOutcome;
  /** Error message, close reason or frame summary — already redacted. */
  detail: string | null;
  /** Raw `x-rate-limit-*` response headers (safe), for budget debugging. */
  rateLimit: Record<string, string> | null;
}

export interface NetworkEvent {
  type: 'network';
  entry: NetworkLogEntry;
}
