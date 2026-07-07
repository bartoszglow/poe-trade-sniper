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

/** Valid range + default for {@link DealWatchConfig.baselineSampleSize} (D-dw-15). */
export const BASELINE_SAMPLE_SIZE_MIN = 3;
export const BASELINE_SAMPLE_SIZE_MAX = 20;
export const DEFAULT_BASELINE_SAMPLE_SIZE = 10;

/**
 * The global default market-refresh cadence (server `DEAL_REFRESH_INTERVAL_MS`
 * default) — the single source of truth shared by the env schema and the UI, so
 * the "Default" option can name its actual value. 1 hour.
 */
export const DEFAULT_DEAL_REFRESH_INTERVAL_MS = 3_600_000;

/**
 * Allowed per-watch market-refresh intervals in ms (D-dw-20): 15m / 30m / 1h /
 * 3h / 6h / 12h. `null` on the config means "use the global
 * DEAL_REFRESH_INTERVAL_MS" (see {@link DEFAULT_DEAL_REFRESH_INTERVAL_MS}).
 */
export const DEAL_REFRESH_INTERVAL_OPTIONS_MS = [
  900_000, 1_800_000, 3_600_000, 10_800_000, 21_600_000, 43_200_000,
] as const;

/** Coerce a persisted/imported refresh interval to an allowed value or null (fail-safe). */
export function normalizeRefreshInterval(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return (DEAL_REFRESH_INTERVAL_OPTIONS_MS as readonly number[]).includes(value) ? value : null;
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
  /**
   * How many of the CHEAPEST usable listings the base price is the median of
   * (D-dw-15, operator-tunable per item: thin markets want ~5, liquid ones 10-20).
   * Also the fetch depth of each market check. Valid 3..20, default 10.
   */
  baselineSampleSize: number;
  /**
   * How often this watch re-checks its market price (D-dw-20), one of
   * {@link DEAL_REFRESH_INTERVAL_OPTIONS_MS}; null = the global
   * DEAL_REFRESH_INTERVAL_MS. Governs the threshold-cutoff freshness, not the
   * live decorator math.
   */
  refreshIntervalMs: number | null;
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
  /**
   * The poe2scout divine rate (exalted per divine) snapshotted at the last
   * baseline refresh — display conversion only (readable divine amounts);
   * null = unknown, the UI falls back to exalted.
   */
  divinePriceExalted: number | null;
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
 * Approximate market price of a search's item (D-dw-14): the same robust
 * baseline the deal watch uses, computed hourly for EVERY active search so the
 * operator always knows what a purchase price compares against. Display-grade,
 * best-effort data — no status machinery; null means "not known (yet)".
 * Deal-mode rows serve this from their own `DealWatchState.baseline`.
 */
export interface MarketPriceSnapshot {
  baseline: DealBaseline;
  /** Divine rate at check time — display conversion (D-dw-11). */
  divinePriceExalted: number | null;
  /** ISO-8601 time of the next scheduled check; null when not scheduled. */
  nextCheckAt: string | null;
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
  /**
   * The divine rate (exalted per divine) AT decoration time, so historical
   * alerts keep converting with the rate that was true when they fired;
   * null = rate unknown, display falls back to exalted.
   */
  divinePriceExalted: number | null;
}
