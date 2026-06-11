interface StatusBarProps {
  serverHealthy: boolean | null;
  serverVersion: string | null;
}

interface StatusDotProps {
  state: 'ok' | 'danger' | 'idle';
  label: string;
}

function StatusDot({ state, label }: StatusDotProps) {
  const dotTone = state === 'ok' ? 'bg-ok' : state === 'danger' ? 'bg-danger' : 'bg-ink-faint';
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotTone}`} />
      {label}
    </span>
  );
}

/**
 * Bottom status strip — the desktop-app home for operational state.
 * Session, rate-limit budget and league populate in Phases 1-4.
 */
export function StatusBar({ serverHealthy, serverVersion }: StatusBarProps) {
  return (
    <div className="flex h-full items-center gap-5 border-t border-edge bg-surface-1 px-4 text-xs text-ink-muted">
      <StatusDot
        state={serverHealthy === null ? 'idle' : serverHealthy ? 'ok' : 'danger'}
        label={serverHealthy === null ? 'server …' : serverHealthy ? 'server' : 'server down'}
      />
      <StatusDot state="idle" label="no session" />
      <span className="text-ink-faint">budget —</span>
      <div className="flex-1" />
      {serverVersion !== null && <span className="font-mono text-ink-faint">v{serverVersion}</span>}
    </div>
  );
}
