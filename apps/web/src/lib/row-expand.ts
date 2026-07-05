/**
 * D-42-1: the whole search-row header toggles its detail panel — EXCEPT clicks
 * that land on interactive controls (switches, buttons, links, inputs, the
 * drag handle) or anything explicitly opted out via `data-no-expand`, clicks
 * that arrive through a React PORTAL (ConfirmDialog renders into document.body
 * but its synthetic events still bubble up the React tree to the header), and
 * clicks that end a TEXT-SELECTION drag (selecting the search id to copy it —
 * the same failure class Modal fixed in 68ac5e7).
 * Structural typing keeps this testable in the node vitest environment.
 */

/** The `closest`-bearing slice of Element this guard actually needs. */
export interface ClosestQueryable {
  closest(selector: string): unknown;
}

/** The `contains`-bearing slice of Element (the header wrapper). */
export interface ContainsQueryable {
  contains(node: unknown): boolean;
}

/** The slice of window.getSelection() the guard reads. */
export interface SelectionLike {
  isCollapsed: boolean;
}

/** Selector of everything a header click must NOT treat as "expand the row". */
export const ROW_EXPAND_EXCLUDED_SELECTOR =
  'button, a, input, select, textarea, [role="switch"], [data-no-expand]';

/** True when a header click at `target` should toggle the row's detail panel. */
export function shouldRowClickExpand(
  currentTarget: unknown,
  target: unknown,
  selection?: SelectionLike | null,
): boolean {
  // A non-collapsed selection means this "click" ended a text-selection drag.
  if (selection && !selection.isCollapsed) return false;
  // Portal guard: the event must originate from a DOM descendant of the header —
  // dialog/backdrop clicks bubble through the React tree but fail this check.
  const container = currentTarget as Partial<ContainsQueryable> | null;
  if (container && typeof container.contains === 'function' && !container.contains(target)) {
    return false;
  }
  if (target === null || typeof target !== 'object') return true;
  const queryable = target as Partial<ClosestQueryable>;
  if (typeof queryable.closest !== 'function') return true;
  return queryable.closest(ROW_EXPAND_EXCLUDED_SELECTOR) === null;
}
