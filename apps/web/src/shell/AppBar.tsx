interface AppBarProps {
  serverHealthy: boolean | null;
  streamConnected: boolean;
}

/**
 * Top app bar. In the Phase 5 frameless Electron window this whole strip
 * becomes the drag region (`.app-drag-region`) and `.app-window-controls`
 * reserves the corner for window buttons — both inert in the browser.
 */
export function AppBar({ serverHealthy, streamConnected }: AppBarProps) {
  const live = streamConnected && serverHealthy !== false;
  return (
    <div className="app-drag-region flex h-full items-center gap-3 border-b border-edge bg-surface-1 px-4">
      <span className="font-mono text-sm font-semibold tracking-wide text-gold">
        poe-trade-sniper
      </span>
      <div className="flex-1" />
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
        {serverHealthy === null && !streamConnected ? 'connecting' : live ? 'live' : 'offline'}
      </span>
      <div className="app-window-controls" />
    </div>
  );
}
