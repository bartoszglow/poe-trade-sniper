import { useT } from '../i18n/i18n';

export interface DetectionModes {
  ws: number;
  poll: number;
  /** Enabled (non-paused) searches — when 0 the pills are hidden. */
  total: number;
}

interface AppBarProps {
  serverHealthy: boolean | null;
  streamConnected: boolean;
  detection: DetectionModes;
}

/** Lit when the mode is currently serving at least one search. */
function ModePill({ label, active, title }: { label: string; active: boolean; title: string }) {
  return (
    <span
      title={title}
      className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.6rem] font-semibold tracking-wide ${
        active ? 'bg-surface-3 text-gold-bright' : 'text-ink-faint'
      }`}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${active ? 'bg-ok' : 'bg-ink-faint'}`}
      />
      {label}
    </span>
  );
}

/**
 * Top app bar. In the Phase 5 frameless Electron window this whole strip
 * becomes the drag region (`.app-drag-region`) and `.app-window-controls`
 * reserves the corner for window buttons — both inert in the browser.
 */
export function AppBar({ serverHealthy, streamConnected, detection }: AppBarProps) {
  const t = useT();
  const live = streamConnected && serverHealthy !== false;
  return (
    <div className="app-drag-region flex h-full items-center gap-3 border-b border-edge bg-surface-1 px-4">
      <span className="font-mono text-sm font-semibold tracking-wide text-gold">
        PoE Trade Sniper
      </span>
      <div className="flex-1" />
      {detection.total > 0 && (
        <div className="flex items-center gap-1">
          <ModePill label="WS" active={detection.ws > 0} title={t('detection.wsTitle')} />
          <ModePill label="POLL" active={detection.poll > 0} title={t('detection.pollTitle')} />
        </div>
      )}
      <span className="flex items-center gap-1.5 text-xs text-ink-muted">
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            serverHealthy === null && !streamConnected
              ? 'bg-ink-faint'
              : live
                ? 'bg-ok'
                : 'bg-danger'
          }`}
        />
        {serverHealthy === null && !streamConnected
          ? t('common.connecting')
          : live
            ? t('common.live')
            : t('common.offline')}
      </span>
      <div className="app-window-controls" />
    </div>
  );
}
