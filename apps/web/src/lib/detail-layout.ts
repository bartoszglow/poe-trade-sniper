/**
 * The single source of truth for how a group of label/value rows is laid out inside
 * a DetailCard — the one place that answers "pack two-per-line, or one-per-line?".
 *
 * Every surface that presents item information feeds its rows through here so they
 * never diverge: the search-criteria view (QueryCriteriaView), the item-detail view
 * (ItemDetailView, used by the Activity feed and the Hits list), and anything added
 * later. Change the rule once, every surface follows.
 *
 * Rule: pack rows into columns only when every row is short enough to sit in a
 * half-width cell without wrapping. A single long affix sentence
 * ("Adds # to # Physical Damage to Attacks") forces the whole group one-per-line, so
 * the sentence stays intact with its value beside it.
 */

export interface DetailRowData {
  label: string;
  /** Right-hand value; omit for a label-only row (e.g. "Instant Buyout"). */
  value?: string;
  /** Filter toggled off in the search — rendered struck-through + tagged. */
  disabled?: boolean;
  /** Monospace-gold emphasis (e.g. the buyout price). */
  accent?: boolean;
  /** Suffix shown after a disabled label, e.g. "(off)". */
  disabledTag?: string;
}

export type DetailRowLayout = 'columns' | 'stack';

/**
 * Max combined `label + value` length (characters) for a row to still count as
 * "compact". Tuned so scalar rows (Base 84, Rarity Rare, Level ≤ 62) pack into
 * columns while affix/stat sentences drop to one-per-line. Centralized so the
 * threshold is one tunable, not a magic number sprinkled across components.
 */
export const COMPACT_ROW_MAX_CHARS = 22;

function rowWeight(row: DetailRowData): number {
  return row.label.length + (row.value?.length ?? 0);
}

/** True when the group is non-empty and every row is short enough to pack two-per-line. */
export function isCompactRowGroup(rows: readonly DetailRowData[]): boolean {
  return rows.length > 0 && rows.every((row) => rowWeight(row) <= COMPACT_ROW_MAX_CHARS);
}

/** The layout a group of rows should use. See the module doc for the rule. */
export function detailRowLayout(rows: readonly DetailRowData[]): DetailRowLayout {
  return isCompactRowGroup(rows) ? 'columns' : 'stack';
}
