import { NavLink } from 'react-router-dom';
import { useT } from '../i18n/i18n';
import { useNetworkViewEnabled } from '../hooks/useNetworkView';
import { NAV_ENTRIES } from './nav';
import { Tooltip } from '../components/Tooltip';

/**
 * Left navigation rail — entries come exclusively from the nav registry.
 * The divider is an inset box-shadow (not `border-r`) so it never consumes column
 * width — the 40px icons stay truly centred in the 48px rail. `relative z-10` lets
 * the hover tooltip paint over the main content column it opens into.
 */
export function IconRail() {
  const t = useT();
  const networkVisible = useNetworkViewEnabled();
  const entries = NAV_ENTRIES.filter((entry) => !entry.devOnly || networkVisible);
  return (
    <nav className="relative z-10 flex flex-col items-center gap-1 bg-surface-1 py-2 shadow-[inset_-1px_0_0_0_var(--color-edge)]">
      {entries.map((entry) => (
        <Tooltip key={entry.id} content={t(entry.labelKey)} placement="right" focusable={false}>
          <NavLink
            to={entry.path}
            end={entry.path === '/'}
            aria-label={t(entry.labelKey)}
            className={({ isActive }) =>
              `flex h-10 w-10 items-center justify-center rounded-md transition-colors ${
                isActive
                  ? 'bg-surface-3 text-gold-bright'
                  : 'text-ink-muted hover:bg-surface-2 hover:text-ink'
              }`
            }
          >
            <entry.icon className="h-6 w-6" />
          </NavLink>
        </Tooltip>
      ))}
    </nav>
  );
}
