/**
 * Deal-watch domain types (plan 41). Deal mode is an in-place transform of a
 * managed search (D-dw-1 v3): the system derives a price-capped GGG search from
 * the operator's definition and keeps the cap tracking a market baseline. All
 * internal price math is in exalted equivalent (D-dw-11); types only — the
 * server's deal-watch module owns the logic.
 */

/** How the deal threshold is interpreted: percent below baseline, or an absolute amount below it. */
export type DealWatchMode = 'percent' | 'absolute';

/**
 * Display + absolute-threshold unit (D-dw-11). Internal math stays in exalted;
 * `divine` is converted via the live DivinePrice rate. Default: `exalted`.
 */
export type DealWatchUnit = 'exalted' | 'divine';

/**
 * Honest-degradation status of one deal watch (plan 41 "Failure modes").
 * Each code maps to an i18n message — raw errors never reach the UI.
 */
export type DealWatchStatusCode =
  | 'active'
  | 'paused'
  /** Enabled/imported but the first derive hasn't landed yet. */
  | 'pending-derive'
  /** Fewer than DEAL_MIN_SAMPLE usable listings — no meaningful baseline, no alerts. */
  | 'insufficient-data'
  /** Baseline older than DEAL_BASELINE_STALE_MS (skipped refreshes); alerts keep firing, flagged stale. */
  | 'baseline-stale'
  /** Derive POST rejected/rate-limited; retried via the queue, old cap keeps running. */
  | 'derive-failed'
  /** Derived id collides with another watched row — no swap performed. */
  | 'derive-conflict'
  /** GGG reports the derived id invalid — recovery re-derive queued. */
  | 'derived-expired'
  /** Item category not supported in v1 (e.g. stackables without per-unit normalization). */
  | 'unsupported-item'
  /** Over DEAL_MAX_WATCHES concurrent deal-mode searches. */
  | 'capped'
  /** Disable requested while detection is paused — the GGG restore runs on resume. */
  | 'restore-pending'
  /** Disable couldn't restore the original search; row keeps its last good state. */
  | 'restore-failed';

/**
 * One market-baseline snapshot: the price-fixer-resistant "standard price"
 * (median of the cheapest K usable survivors after outlier drop, D-dw-2),
 * normalized to exalted.
 */
export interface DealBaseline {
  /** The robust baseline price in exalted equivalent. */
  amountExalted: number;
  /** Usable listings the statistic was computed from. */
  sampleSize: number;
  /** Raw cheapest usable listing (display only — never the baseline itself). */
  rawLowestExalted: number;
  /** ISO-8601 time the baseline was computed. */
  computedAt: string;
  /** Total listings returned by the baseline query, usable or not. */
  listingsSeen: number;
}

/** Operator-set deal configuration — the part that travels in export/import (D-dw-10). */
export interface DealWatchConfig {
  /**
   * Stable internal identity of the watch (uuid) — the search's GGG id churns
   * on every re-derive, so anything that must survive swaps (baseline history
   * rows, D-dw-12) keys off this instead.
   */
  watchId: string;
  mode: DealWatchMode;
  /** 30 (percent mode) or an amount in `unit` (absolute mode). */
  thresholdValue: number;
  /** Display + absolute-threshold unit (D-dw-11). */
  unit: DealWatchUnit;
  /** The operator's trade query minus its price filter — baseline + derive source (opaque here). */
  definition: unknown;
  /** The pre-transform search id, restored on disable. */
  originalSearchId: string;
  /** Snapshot of the query's original price filter, restored on disable (opaque here). */
  originalPriceFilter: unknown;
}

/** Full runtime state of a deal watch, persisted 1:1 with the search row (D-dw-4). */
export interface DealWatchState extends DealWatchConfig {
  /** Newest baseline — live discount math always uses this; null before the first success. */
  baseline: DealBaseline | null;
  /** Snapshot that produced the CURRENT cap — the drift reference (plan 41 R3), so slow drift accumulates. */
  capBaseline: DealBaseline | null;
  /** The cap actually POSTed to GGG, in exalted equivalent (D-dw-6 no-option cap); null before the first derive. */
  capExalted: number | null;
  /** ISO-8601 time the current derived id was minted — drives max-id-age forced re-derive. */
  derivedCreatedAt: string | null;
  status: DealWatchStatusCode;
  /** ISO-8601 time of the next scheduled baseline refresh (relative + jittered, R7). */
  nextRefreshAt: string | null;
}

/**
 * One baseline-history sample (D-dw-12), newest-first from
 * `GET /api/searches/:id/deal-history`. Keyed server-side by the stable
 * `watchId`, so the series survives derived-id swaps.
 */
export interface DealBaselineHistoryEntry {
  amountExalted: number;
  rawLowestExalted: number;
  sampleSize: number;
  /** True when this refresh moved the cap (re-derive) — the Activity-feed subset. */
  rederived: boolean;
  computedAt: string;
}

/**
 * Discount context attached to a deal alert (D-dw-5), computed against the live
 * baseline at persistence time. All-null discount fields = baseline was missing
 * when the hit landed (still a `deal` event, never a bare `hit`).
 */
export interface DealHitInfo {
  /** Baseline used for the discount math, in exalted; null when no baseline existed. */
  baselineExalted: number | null;
  /** Discount vs baseline in percent (e.g. 32 for −32%); null without a baseline. */
  discountPercent: number | null;
  /** Absolute discount vs baseline in exalted; null without a baseline. */
  discountExalted: number | null;
  /** True when the baseline was older than DEAL_BASELINE_STALE_MS — surfaced in the UI. */
  baselineStale: boolean;
}
