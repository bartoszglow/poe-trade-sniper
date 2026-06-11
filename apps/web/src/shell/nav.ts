import type { ComponentType } from 'react';
import { Crosshair, History, Settings } from 'lucide-react';
import { SearchesPage } from '../pages/SearchesPage';
import { HitsPage } from '../pages/HitsPage';
import { SettingsPage } from '../pages/SettingsPage';

export interface NavEntry {
  id: string;
  path: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  page: ComponentType;
}

/**
 * The open/closed seam of the shell: adding a page = adding an entry here.
 * The rail, routes and titles all derive from this registry — the shell
 * components never change.
 */
export const NAV_ENTRIES: NavEntry[] = [
  { id: 'searches', path: '/', label: 'Searches', icon: Crosshair, page: SearchesPage },
  { id: 'hits', path: '/hits', label: 'Hits', icon: History, page: HitsPage },
  { id: 'settings', path: '/settings', label: 'Settings', icon: Settings, page: SettingsPage },
];
