import { useLayoutEffect, useRef } from 'react';

/**
 * Minimal FLIP reorder animation for a keyed list. Each render it measures the
 * children's layout position (`offsetTop`, immune to in-flight transforms) and
 * glides any that moved from their previous slot to the new one — so a re-sort
 * reads as motion, not a teleport.
 *
 * Dependency-free and StrictMode-safe: re-measuring is idempotent, and the first
 * pass (no recorded positions) animates nothing. Children must carry a stable
 * `data-flip-id`. Honors `prefers-reduced-motion`.
 */
export function useFlipList<T extends HTMLElement>() {
  const containerRef = useRef<T>(null);
  const previousTops = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const children = Array.from(container.children) as HTMLElement[];
    const nextTops = new Map<string, number>();

    for (const child of children) {
      const id = child.dataset['flipId'];
      if (!id) continue;
      const top = child.offsetTop;
      nextTops.set(id, top);
      if (reduceMotion) continue;
      const previous = previousTops.current.get(id);
      if (previous !== undefined && Math.abs(previous - top) > 1) {
        child.animate(
          [{ transform: `translateY(${previous - top}px)` }, { transform: 'translateY(0)' }],
          { duration: 220, easing: 'ease-in-out' },
        );
      }
    }
    previousTops.current = nextTops;
  });

  return containerRef;
}
