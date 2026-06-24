import { useEffect, useState } from 'react';

/**
 * Returns `value` delayed until it stops changing for `delayMs` — coalescing a
 * rapid burst of updates into a single downstream change. Used to absorb an
 * `engine-status` SSE burst during GGG socket churn (one `/api/searches`
 * refetch instead of N) and to throttle the hits search box. The first value is
 * returned immediately — mount is not delayed.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
