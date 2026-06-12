import { useEffect, useState } from 'react';

/**
 * Visibility of the developer "Network" view. Mainly a dev tool; an operator
 * can hide it (the on-disk log keeps being written regardless). Persisted to
 * localStorage; a custom event keeps the rail and Settings in sync live.
 */
const STORAGE_KEY = 'sniper.networkView';
const CHANGE_EVENT = 'sniper:network-view-changed';

export function isNetworkViewEnabled(): boolean {
  // Default ON during development; an operator build can flip it off in Settings.
  return localStorage.getItem(STORAGE_KEY) !== '0';
}

export function setNetworkViewEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useNetworkViewEnabled(): boolean {
  const [enabled, setEnabled] = useState(isNetworkViewEnabled);
  useEffect(() => {
    const handler = () => setEnabled(isNetworkViewEnabled());
    window.addEventListener(CHANGE_EVENT, handler);
    return () => window.removeEventListener(CHANGE_EVENT, handler);
  }, []);
  return enabled;
}
