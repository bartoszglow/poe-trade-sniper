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
