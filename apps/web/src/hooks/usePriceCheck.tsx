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

  // A desktop hotkey pushes item text via a window event (preload → renderer).
  useEffect(() => {
    const onHotkeyItem = (event: Event) => {
      const detail = (event as CustomEvent<{ itemText?: string }>).detail;
      if (detail?.itemText) void check(detail.itemText);
    };
    window.addEventListener(HOTKEY_EVENT, onHotkeyItem);
    return () => window.removeEventListener(HOTKEY_EVENT, onHotkeyItem);
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
