import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { PriceCheckDraft, PriceCheckHistoryEntry, PriceCheckResult } from '@poe-sniper/shared';
import { apiGet, apiSend } from '../lib/api';

/** One entry in the recent-price-checks history (newest first). */
export interface PriceCheckEntry {
  id: number;
  /** Epoch ms of the check — the Price Checks view shows a relative time. */
  at: number;
  result: PriceCheckResult;
}

/** Newest-first cap in the view — the server keeps a matching durable window (#17). */
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
  /** Parse item text into an editable draft (#38 A) — no query, no budget. */
  parse: (itemText: string) => Promise<PriceCheckDraft | null>;
  /** Price the operator's edited draft (#38 A). Resolves true on success, false on
   *  failure — so the caller can keep the draft to retry instead of wiping it. */
  priceDraft: (draft: PriceCheckDraft) => Promise<boolean>;
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
  // Local (optimistic) entries get NEGATIVE ids, decrementing — a distinct id space
  // from the server's positive row ids, so merging a server seed can dedupe by id
  // without a small local id colliding with an unrelated server row. No Math.random
  // / crypto in render.
  const nextIdRef = useRef(-1);

  // Record a computed result as the latest AND prepend it to the capped history.
  const recordResult = useCallback((next: PriceCheckResult) => {
    setResult(next);
    setError(null);
    setChecking(false);
    const entry: PriceCheckEntry = { id: nextIdRef.current--, at: Date.now(), result: next };
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

  const parse = useCallback(async (itemText: string): Promise<PriceCheckDraft | null> => {
    if (!itemText.trim()) return null;
    setError(null);
    try {
      return await apiSend<PriceCheckDraft>('POST', '/api/price-check/parse', { itemText });
    } catch {
      setError('failed');
      return null;
    }
  }, []);

  const priceDraft = useCallback(
    async (draft: PriceCheckDraft): Promise<boolean> => {
      setChecking(true);
      setError(null);
      try {
        const next = await apiSend<PriceCheckResult>('POST', '/api/price-check/price', { draft });
        recordResult(next);
        return true;
      } catch {
        setError('failed');
        setChecking(false);
        return false;
      }
    },
    [recordResult],
  );

  const clear = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    void apiSend('DELETE', '/api/price-check/history').catch(() => {
      /* the durable log is best-effort; the view already cleared */
    });
  }, []);

  // Seed the history from the durable server log once on mount (#17), so the
  // Price Checks view survives a restart; live checks prepend on top after.
  useEffect(() => {
    apiGet<PriceCheckHistoryEntry[]>('/api/price-check/history')
      .then((entries) => {
        const seeded: PriceCheckEntry[] = entries.slice(0, HISTORY_CAP).map((entry) => ({
          id: entry.id,
          at: new Date(entry.at).getTime(),
          result: entry.result,
        }));
        // Merge, NOT replace: a check recorded while this GET was in flight (a fast
        // paste or a desktop RESULT_EVENT) keeps its optimistic entry on top; the
        // server rows fill in beneath it. Dedupe by id AND by result-signature —
        // an optimistic entry (negative id) and its own just-persisted server row
        // (positive id) carry the SAME result JSON, so the signature drops the twin.
        setHistory((previous) => {
          const seenIds = new Set(previous.map((entry) => entry.id));
          const seenSignatures = new Set(previous.map((entry) => JSON.stringify(entry.result)));
          const fresh = seeded.filter(
            (entry) => !seenIds.has(entry.id) && !seenSignatures.has(JSON.stringify(entry.result)),
          );
          return [...previous, ...fresh].slice(0, HISTORY_CAP);
        });
      })
      .catch(() => {
        /* keep the empty in-memory history if the fetch fails */
      });
  }, []);

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
      value={{ result, history, checking, error, check, parse, priceDraft, clear, clearHistory }}
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
