import { formatSearchBudget, type ServerStatus } from '../hooks/useServerStatus';
import { useT } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';

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

function sessionDot(serverStatus: ServerStatus | null): {
  state: StatusDotProps['state'];
  labelKey: MessageKey;
} {
  const session = serverStatus?.session;
  if (!session?.hasSession) return { state: 'idle', labelKey: 'status.noSession' };
  if (session.probedValid === true) return { state: 'ok', labelKey: 'status.session' };
  if (session.probedValid === false) return { state: 'danger', labelKey: 'status.sessionInvalid' };
  return { state: 'warn', labelKey: 'status.sessionUnprobed' };
}

/** Bottom status strip — the desktop-app home for operational state. */
export function StatusBar({ serverHealthy, serverVersion, serverStatus }: StatusBarProps) {
  const t = useT();
  const budget = formatSearchBudget(serverStatus);
  const paused = serverStatus?.rateLimit.pausedUntil ?? null;
  const travelQueue = serverStatus?.travel.queueLength ?? 0;
  const session = sessionDot(serverStatus);

  return (
    <div className="flex h-full items-center gap-5 border-t border-edge bg-surface-1 px-4 text-xs text-ink-muted">
      <StatusDot
        state={serverHealthy === null ? 'idle' : serverHealthy ? 'ok' : 'danger'}
        label={
          serverHealthy === null
            ? t('status.serverChecking')
            : serverHealthy
              ? t('status.server')
              : t('status.serverDown')
        }
      />
      <StatusDot state={session.state} label={t(session.labelKey)} />
      {paused ? (
        <span className="text-danger">
          {t('status.rateLimitedUntil', { time: new Date(paused).toLocaleTimeString() })}
        </span>
      ) : (
        <span className="text-ink-faint">
          {t('status.searchBudget', { budget: budget ?? '—' })}
        </span>
      )}
      {travelQueue > 0 && (
        <span className="text-gold">{t('status.travelQueue', { count: travelQueue })}</span>
      )}
      <div className="flex-1" />
      {serverVersion !== null && <span className="font-mono text-ink-faint">v{serverVersion}</span>}
    </div>
  );
}
