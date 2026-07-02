import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { PriceCheckResult } from '@poe-sniper/shared';
import { apiSend } from '../lib/api';

interface PriceCheckState {
  /** Latest result (from a paste or a desktop hotkey), or null. */
  result: PriceCheckResult | null;
  checking: boolean;
  error: string | null;
  /** Run a check for raw item text (paste surface + desktop bridge). */
  check: (itemText: string) => Promise<void>;
  clear: () => void;
}

const PriceCheckContext = createContext<PriceCheckState | null>(null);

/** Custom event a desktop-hotkey bridge dispatches with item text to price. */
const HOTKEY_EVENT = 'sniper:price-check-item';
/** Custom event carrying an ALREADY-computed result (desktop POSTs once, then
 *  pushes the result to the panel — avoids double-spending the search budget). */
const RESULT_EVENT = 'sniper:price-check-result';

/**
 * App-wide price-check state (#37): a paste in Settings/panel or a desktop
 * hotkey both feed the SAME result, shown in the in-app panel. Provider-level
 * so the result survives view changes (like the live-hits feed).
 */
export function PriceCheckProvider({ children }: { children: ReactNode }) {
  const [result, setResult] = useState<PriceCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async (itemText: string) => {
    if (!itemText.trim()) return;
    setChecking(true);
    setError(null);
    try {
      const next = await apiSend<PriceCheckResult>('POST', '/api/price-check', { itemText });
      setResult(next);
    } catch {
      setError('failed');
    } finally {
      setChecking(false);
    }
  }, []);

  const clear = useCallback(() => {
    setResult(null);
    setError(null);
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
      if (detail?.result) {
        setResult(detail.result);
        setChecking(false);
        setError(null);
      }
    };
    window.addEventListener(HOTKEY_EVENT, onHotkeyItem);
    window.addEventListener(RESULT_EVENT, onResult);
    return () => {
      window.removeEventListener(HOTKEY_EVENT, onHotkeyItem);
      window.removeEventListener(RESULT_EVENT, onResult);
    };
  }, [check]);

  return (
    <PriceCheckContext.Provider value={{ result, checking, error, check, clear }}>
      {children}
    </PriceCheckContext.Provider>
  );
}

export function usePriceCheck(): PriceCheckState {
  const context = useContext(PriceCheckContext);
  if (!context) throw new Error('usePriceCheck must be used within a PriceCheckProvider');
  return context;
}
