import type { ComponentType } from 'react';
import { Activity, Crosshair, History, Settings } from 'lucide-react';
import type { MessageKey } from '../i18n/messages';
import { SearchesPage } from '../pages/SearchesPage';
import { HitsPage } from '../pages/HitsPage';
import { NetworkPage } from '../pages/NetworkPage';
import { SettingsPage } from '../pages/SettingsPage';

export interface NavEntry {
  id: string;
  path: string;
  /** Catalog key — hooks can't run at module scope, so labels resolve in the rail. */
  labelKey: MessageKey;
  icon: ComponentType<{ className?: string }>;
  page: ComponentType;
  /** Developer-only entry — hidden from the rail when the dev view is off. */
  devOnly?: boolean;
}

/**
 * The open/closed seam of the shell: adding a page = adding an entry here.
 * The rail, routes and titles all derive from this registry — the shell
 * components never change.
 */
export const NAV_ENTRIES: NavEntry[] = [
  { id: 'searches', path: '/', labelKey: 'nav.searches', icon: Crosshair, page: SearchesPage },
  { id: 'hits', path: '/hits', labelKey: 'nav.hits', icon: History, page: HitsPage },
  {
    id: 'network',
    path: '/network',
    labelKey: 'nav.network',
    icon: Activity,
    page: NetworkPage,
    devOnly: true,
  },
  {
    id: 'settings',
    path: '/settings',
    labelKey: 'nav.settings',
    icon: Settings,
    page: SettingsPage,
  },
];
