import { formatSearchBudget, type ServerStatus } from '../hooks/useServerStatus';

interface StatusBarProps {
  serverHealthy: boolean | null;
  serverVersion: string | null;
  serverStatus: ServerStatus | null;
}

interface StatusDotProps {
  state: 'ok' | 'warn' | 'danger' | 'idle';
  label: string;
}

function StatusDot({ state, label }: StatusDotProps) {
  const dotTone =
    state === 'ok'
      ? 'bg-ok'
      : state === 'warn'
        ? 'bg-warn'
        : state === 'danger'
          ? 'bg-danger'
          : 'bg-ink-faint';
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotTone}`} />
      {label}
    </span>
  );
}

function sessionDot(serverStatus: ServerStatus | null): StatusDotProps {
  const session = serverStatus?.session;
  if (!session?.hasSession) return { state: 'idle', label: 'no session' };
  if (session.probedValid === true) return { state: 'ok', label: 'session' };
  if (session.probedValid === false) return { state: 'danger', label: 'session invalid' };
  return { state: 'warn', label: 'session unprobed' };
}

/** Bottom status strip — the desktop-app home for operational state. */
export function StatusBar({ serverHealthy, serverVersion, serverStatus }: StatusBarProps) {
  const budget = formatSearchBudget(serverStatus);
  const paused = serverStatus?.rateLimit.pausedUntil ?? null;
  const travelQueue = serverStatus?.travel.queueLength ?? 0;

  return (
    <div className="flex h-full items-center gap-5 border-t border-edge bg-surface-1 px-4 text-xs text-ink-muted">
      <StatusDot
        state={serverHealthy === null ? 'idle' : serverHealthy ? 'ok' : 'danger'}
        label={serverHealthy === null ? 'server …' : serverHealthy ? 'server' : 'server down'}
      />
      <StatusDot {...sessionDot(serverStatus)} />
      {paused ? (
        <span className="text-danger">
          rate-limited until {new Date(paused).toLocaleTimeString()}
        </span>
      ) : (
        <span className="text-ink-faint">search {budget ?? '—'}</span>
      )}
      {travelQueue > 0 && <span className="text-gold">travel queue: {travelQueue}</span>}
      <div className="flex-1" />
      {serverVersion !== null && <span className="font-mono text-ink-faint">v{serverVersion}</span>}
    </div>
  );
}
