import { NavLink } from 'react-router-dom';
import { useT } from '../i18n/i18n';
import { NAV_ENTRIES } from './nav';

/** Left navigation rail — entries come exclusively from the nav registry. */
export function IconRail() {
  const t = useT();
  return (
    <nav className="flex flex-col items-center gap-1 border-r border-edge bg-surface-1 py-2">
      {NAV_ENTRIES.map((entry) => (
        <NavLink
          key={entry.id}
          to={entry.path}
          end={entry.path === '/'}
          title={t(entry.labelKey)}
          aria-label={t(entry.labelKey)}
          className={({ isActive }) =>
            `flex h-9 w-9 items-center justify-center rounded-md transition-colors ${
              isActive
                ? 'bg-surface-3 text-gold-bright'
                : 'text-ink-muted hover:bg-surface-2 hover:text-ink'
            }`
          }
        >
          <entry.icon className="h-4.5 w-4.5" />
        </NavLink>
      ))}
    </nav>
  );
}
