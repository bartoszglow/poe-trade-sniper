import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { PriceCheckResult } from '@poe-sniper/shared';
import { apiSend } from '../lib/api';

/** One entry in the recent-price-checks history (session-local, newest first). */
export interface PriceCheckEntry {
  id: number;
  /** Epoch ms of the check — the Price Checks view shows a relative time. */
  at: number;
  result: PriceCheckResult;
}

/** Newest-first cap — recent lookups, not an audit log (kept in memory only). */
const HISTORY_CAP = 50;

interface PriceCheckState {
  /** Latest result (from a paste or a desktop hotkey), or null. */
  result: PriceCheckResult | null;
  /** All recent checks, newest first (session-local, capped). */
  history: PriceCheckEntry[];
  checking: boolean;
  error: string | null;
  /** Run a check for raw item text (paste surface + desktop bridge). */
  check: (itemText: string) => Promise<void>;
  /** Clear the latest result (the side panel / overlay surface). */
  clear: () => void;
  /** Clear the whole recent-checks history (the Price Checks view). */
  clearHistory: () => void;
}

const PriceCheckContext = createContext<PriceCheckState | null>(null);

/** Custom event a desktop-hotkey bridge dispatches with item text to price. */
const HOTKEY_EVENT = 'sniper:price-check-item';
/** Custom event carrying an ALREADY-computed result (desktop POSTs once, then
 *  pushes the result to the panel — avoids double-spending the search budget). */
const RESULT_EVENT = 'sniper:price-check-result';

/**
 * App-wide price-check state (#37): a paste (Settings / Price Checks view) or a
 * desktop hotkey feed the SAME result — shown in the in-app panel and appended
 * to the recent-checks history. Provider-level so both the latest result and
 * the history survive view changes (like the live-hits feed).
 */
export function PriceCheckProvider({ children }: { children: ReactNode }) {
  const [result, setResult] = useState<PriceCheckResult | null>(null);
  const [history, setHistory] = useState<PriceCheckEntry[]>([]);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Monotonic id source — a counter, so no Math.random / crypto in render.
  const nextIdRef = useRef(1);

  // Record a computed result as the latest AND prepend it to the capped history.
  const recordResult = useCallback((next: PriceCheckResult) => {
    setResult(next);
    setError(null);
    setChecking(false);
    const entry: PriceCheckEntry = { id: nextIdRef.current++, at: Date.now(), result: next };
    setHistory((previous) => [entry, ...previous].slice(0, HISTORY_CAP));
  }, []);

  const check = useCallback(
    async (itemText: string) => {
      if (!itemText.trim()) return;
      setChecking(true);
      setError(null);
      try {
        const next = await apiSend<PriceCheckResult>('POST', '/api/price-check', { itemText });
        recordResult(next);
      } catch {
        setError('failed');
        setChecking(false);
      }
    },
    [recordResult],
  );

  const clear = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  const clearHistory = useCallback(() => setHistory([]), []);

  // A desktop hotkey pushes item text (web/dev path) OR a pre-computed result
  // (desktop bridge, which POSTs once and distributes) via window events.
  useEffect(() => {
    const onHotkeyItem = (event: Event) => {
      const detail = (event as CustomEvent<{ itemText?: string }>).detail;
      if (detail?.itemText) void check(detail.itemText);
    };
    const onResult = (event: Event) => {
      const detail = (event as CustomEvent<{ result?: PriceCheckResult }>).detail;
      if (detail?.result) recordResult(detail.result);
    };
    window.addEventListener(HOTKEY_EVENT, onHotkeyItem);
    window.addEventListener(RESULT_EVENT, onResult);
    return () => {
      window.removeEventListener(HOTKEY_EVENT, onHotkeyItem);
      window.removeEventListener(RESULT_EVENT, onResult);
    };
  }, [check, recordResult]);

  return (
    <PriceCheckContext.Provider
      value={{ result, history, checking, error, check, clear, clearHistory }}
    >
      {children}
    </PriceCheckContext.Provider>
  );
}

export function usePriceCheck(): PriceCheckState {
  const context = useContext(PriceCheckContext);
  if (!context) throw new Error('usePriceCheck must be used within a PriceCheckProvider');
  return context;
}
