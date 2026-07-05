import { useEffect, useState } from 'react';

export interface PanelExpansion {
  /** Content is mounted (lazy — a closed panel costs nothing). */
  panelRendered: boolean;
  /** Height state driving the grid 0fr→1fr transition. */
  panelShown: boolean;
  // Function-property (not method) types: these are closures with no `this`,
  // so callers may pass them as bare handlers (no unbound-method warning).
  /** Open (mount + expand). Safe to call during render (adjust-during-render). */
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
}

/**
 * The detail panel's expand/collapse state machine (plan 42, D-42-1), shared
 * by SearchRow and ArchivedSearchRow: mount and height are two states —
 * `panelRendered` mounts the content, `panelShown` drives the ~200ms grid
 * 0fr→1fr transition; close unmounts after the transition window (timer, not
 * transitionend — the event never fires under prefers-reduced-motion).
 */
export function usePanelExpansion(): PanelExpansion {
  const [panelRendered, setPanelRendered] = useState(false);
  const [panelShown, setPanelShown] = useState(false);
  useEffect(() => {
    if (!panelRendered) return undefined;
    // Commit the 0fr frame first, then flip to 1fr so the height animates
    // (covers any future path that mounts without opening in the same commit).
    const frame = requestAnimationFrame(() => setPanelShown(true));
    return () => cancelAnimationFrame(frame);
  }, [panelRendered]);
  useEffect(() => {
    if (panelShown || !panelRendered) return undefined;
    const timer = setTimeout(() => setPanelRendered(false), 300);
    return () => clearTimeout(timer);
  }, [panelShown, panelRendered]);

  function openPanel(): void {
    setPanelRendered(true);
    setPanelShown(true);
  }
  function closePanel(): void {
    setPanelShown(false);
  }
  function togglePanel(): void {
    if (panelShown) closePanel();
    else openPanel();
  }
  return { panelRendered, panelShown, openPanel, closePanel, togglePanel };
}

export interface ExpandTransition {
  /** Content is mounted (kept through the collapse transition, then dropped). */
  rendered: boolean;
  /** Height state driving the grid 0fr→1fr transition. */
  shown: boolean;
}

/**
 * The same ~200ms grid 0fr→1fr expand/collapse as {@link usePanelExpansion},
 * but CONTROLLED by an external `open` boolean — for a section whose expanded
 * state lives elsewhere (e.g. a room's server-persisted `collapsed` flag). Mounts
 * on open, commits the 0fr frame before flipping to 1fr, and unmounts after the
 * transition window on close (timer, not transitionend — that event never fires
 * under prefers-reduced-motion).
 */
export function useExpandTransition(open: boolean): ExpandTransition {
  const [rendered, setRendered] = useState(open);
  const [shown, setShown] = useState(open);

  // Adjust-during-render (no effect, so no cascading-render lint): opening mounts
  // immediately so the 0fr frame commits before paint; closing flips to 0fr at
  // once (the transition then plays) and the content unmounts on the timer below.
  // Each guard self-clears on the re-render, so neither loops.
  if (open && !rendered) setRendered(true);
  if (!open && shown) setShown(false);

  useEffect(() => {
    // Once mounted and opening, commit 0fr then flip to 1fr so height animates.
    if (!open || shown) return undefined;
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, [open, shown]);
  useEffect(() => {
    // Drop the content after the collapse transition (timer, not transitionend —
    // that never fires under prefers-reduced-motion).
    if (open || !rendered) return undefined;
    const timer = setTimeout(() => setRendered(false), 300);
    return () => clearTimeout(timer);
  }, [open, rendered]);

  return { rendered, shown };
}
