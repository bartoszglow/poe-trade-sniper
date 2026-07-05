import type {
  DealWatchMode,
  DealWatchState,
  DealWatchStatusCode,
  DealWatchUnit,
} from '@poe-sniper/shared';
import type { BadgeTone } from '../components/Badge';
import type { MessageKey } from '../i18n/messages';
import { formatPriceAmount } from './format-price';
import { parseQueryCriteria } from './query-criteria';

/**
 * Deal-watch display mapping (plan 41 Phase 2, W1): one shared translation of
 * the server's DealWatchStatusCode into UI signals — the row chip's status dot,
 * the modal's status badge, and the i18n label — so every surface agrees.
 */

/** Traffic-light state of the row chip's status dot. */
export type DealWatchDotState = 'ok' | 'info' | 'warn' | 'danger';

export interface DealWatchStatusDisplay {
  /** Existing dealWatch.status.* catalog entry — codes never render raw. */
  labelKey: MessageKey;
  tone: BadgeTone;
  dotState: DealWatchDotState;
}

/**
 * Exhaustive on purpose: a new DealWatchStatusCode won't compile until it
 * declares its tone + dot here (the EngineStatus mapping pattern).
 */
export const DEAL_STATUS_DISPLAY: Record<DealWatchStatusCode, DealWatchStatusDisplay> = {
  active: { labelKey: 'dealWatch.status.active', tone: 'ok', dotState: 'ok' },
  paused: { labelKey: 'dealWatch.status.paused', tone: 'info', dotState: 'info' },
  'pending-derive': { labelKey: 'dealWatch.status.pending-derive', tone: 'info', dotState: 'info' },
  'insufficient-data': {
    labelKey: 'dealWatch.status.insufficient-data',
    tone: 'warn',
    dotState: 'warn',
  },
  'baseline-stale': { labelKey: 'dealWatch.status.baseline-stale', tone: 'warn', dotState: 'warn' },
  'derive-failed': {
    labelKey: 'dealWatch.status.derive-failed',
    tone: 'danger',
    dotState: 'danger',
  },
  'derive-conflict': {
    labelKey: 'dealWatch.status.derive-conflict',
    tone: 'danger',
    dotState: 'danger',
  },
  'derived-expired': {
    labelKey: 'dealWatch.status.derived-expired',
    tone: 'warn',
    dotState: 'warn',
  },
  'unsupported-item': {
    labelKey: 'dealWatch.status.unsupported-item',
    tone: 'danger',
    dotState: 'danger',
  },
  capped: { labelKey: 'dealWatch.status.capped', tone: 'warn', dotState: 'warn' },
  'restore-pending': {
    labelKey: 'dealWatch.status.restore-pending',
    tone: 'info',
    dotState: 'info',
  },
  'restore-failed': {
    labelKey: 'dealWatch.status.restore-failed',
    tone: 'danger',
    dotState: 'danger',
  },
};

/** Status dot → theme-token background class (used by the row chip + modal). */
export const DEAL_DOT_CLASSES: Record<DealWatchDotState, string> = {
  ok: 'bg-ok',
  info: 'bg-info',
  warn: 'bg-warn',
  danger: 'bg-danger',
};

/** Short display suffix per pricing unit (D-dw-11). */
const UNIT_SUFFIXES: Record<DealWatchUnit, string> = {
  exalted: 'ex',
  divine: 'div',
};

/** U+2212 minus sign — typographically correct for "below market". */
const MINUS_SIGN = '−';

/** The row chip's threshold text: `−30%` / `−5 div` / `−12 ex`. */
export function formatDealThresholdChip(
  mode: DealWatchMode,
  thresholdValue: number,
  unit: DealWatchUnit,
): string {
  if (mode === 'percent') return `${MINUS_SIGN}${formatPriceAmount(thresholdValue)}%`;
  return `${MINUS_SIGN}${formatPriceAmount(thresholdValue)} ${UNIT_SUFFIXES[unit]}`;
}

/**
 * Divine-aware magnitude display (operator request 2026-07-05): exalted is
 * worth so little that real amounts read as unusable five-digit numbers, so
 * anything at or above one divine renders in divine with one decimal
 * ('74.8 div'); smaller amounts — or an unknown rate — stay exalted
 * ('516 ex'). Display only: every computation stays in exalted.
 */
function crossesDivine(
  amountExalted: number,
  divinePriceExalted: number | null,
): divinePriceExalted is number {
  return (
    divinePriceExalted !== null &&
    divinePriceExalted > 0 &&
    Math.abs(amountExalted) >= divinePriceExalted
  );
}

/** One-decimal divine amount with a trimmed '.0' ('74.8 div', '75 div'). */
function formatDivineAmount(amountExalted: number, divinePriceExalted: number): string {
  return `${Number((amountExalted / divinePriceExalted).toFixed(1)).toString()} div`;
}

/** Magnitude-aware amount: `74.8 div` at ≥1 divine, else `516 ex`. */
export function formatExaltedAmount(
  amountExalted: number,
  divinePriceExalted: number | null,
): string {
  if (crossesDivine(amountExalted, divinePriceExalted)) {
    return formatDivineAmount(amountExalted, divinePriceExalted);
  }
  return `${formatPriceAmount(amountExalted)} ex`;
}

/**
 * Magnitude-aware amount with the exact exalted value alongside when the
 * primary is divine — for surfaces with room (the modal's baseline card).
 */
export function formatExaltedDetailed(
  amountExalted: number,
  divinePriceExalted: number | null,
): { primary: string; secondary: string | null } {
  if (crossesDivine(amountExalted, divinePriceExalted)) {
    return {
      primary: formatDivineAmount(amountExalted, divinePriceExalted),
      secondary: `${formatPriceAmount(amountExalted)} ex`,
    };
  }
  return { primary: `${formatPriceAmount(amountExalted)} ex`, secondary: null };
}

/** Signed magnitude-aware delta for trend labels: `+2.3 div`, `−8 ex`, `0 ex`. */
export function formatSignedExaltedAmount(
  amountExalted: number,
  divinePriceExalted: number | null,
): string {
  if (crossesDivine(amountExalted, divinePriceExalted)) {
    const magnitudeText = formatDivineAmount(Math.abs(amountExalted), divinePriceExalted);
    return `${amountExalted > 0 ? '+' : MINUS_SIGN}${magnitudeText}`;
  }
  const magnitudeText = formatPriceAmount(Math.abs(amountExalted));
  // A tiny delta can round to "0" — show it unsigned rather than as "+0"/"−0".
  if (magnitudeText === '0') return '0 ex';
  const sign = amountExalted > 0 ? '+' : MINUS_SIGN;
  return `${sign}${magnitudeText} ex`;
}

/**
 * Client-side alert cutoff for the modal's live summary line, in exalted.
 * Mirrors the server's cutoff math (plan 41 "Deal condition"), floored at 0 so
 * a degenerate threshold reads as "≤ 0 ex" instead of a negative price.
 * Returns null when it cannot be honest: no baseline yet, or an absolute-divine
 * threshold (the server converts via the LIVE divine rate — the client must not
 * guess one).
 */
export function computeClientCutoffExalted(
  config: { mode: DealWatchMode; thresholdValue: number; unit: DealWatchUnit },
  baselineExalted: number | null,
): number | null {
  if (baselineExalted === null) return null;
  if (config.mode === 'percent') {
    return Math.max(0, baselineExalted * (1 - config.thresholdValue / 100));
  }
  if (config.unit === 'divine') return null;
  return Math.max(0, baselineExalted - config.thresholdValue);
}

/**
 * Whether a deal definition pins an item identity (name or base type). A query
 * that pins neither matches a whole category, so its baseline may mix different
 * items — the modal shows the broad-query warning then (warn, never block).
 */
export function dealQueryPinsItem(query: unknown): boolean {
  const criteria = parseQueryCriteria(query, null);
  return criteria.itemRows.some((row) => row.label === 'Name' || row.label === 'Type');
}

/** The deal definition to inspect for warnings: the watch's own definition when
 *  deal mode is on, else the row's current (original) query. */
export function dealDefinitionOf(dealWatch: DealWatchState | null, rowFilters: unknown): unknown {
  return dealWatch === null ? rowFilters : dealWatch.definition;
}

/**
 * Coded PATCH-409 bodies from deal-watch enable/edit mapped to their catalog
 * messages (review P2-2): the server refuses with `{code}` only — prose never
 * crosses the wire, unknown codes fall back to the generic failure.
 */
export const DEAL_PATCH_ERROR_KEYS: Partial<Record<string, MessageKey>> = {
  'deal-unsupported-item': 'dealWatch.status.unsupported-item',
  'deal-capped': 'dealWatch.status.capped',
};
