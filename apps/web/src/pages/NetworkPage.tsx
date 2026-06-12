import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Copy, Pause, Play, Trash2 } from 'lucide-react';
import type { NetworkLogEntry, NetworkOutcome } from '@poe-sniper/shared';
import { Badge, type BadgeTone } from '../components/Badge';
import { Button } from '../components/Button';
import { Select } from '../components/Select';
import { Switch } from '../components/Switch';
import { TextInput } from '../components/TextInput';
import { useEventStream } from '../hooks/EventStreamProvider';
import { useT } from '../i18n/i18n';
import { apiGet } from '../lib/api';
import { formatRelativeMagnitude } from '../lib/relative-time';

interface NetworkSnapshot {
  entries: NetworkLogEntry[];
  logFilePath: string;
}

const RELATIVE_TICK_MS = 1000;

/** Outcomes that are NOT a problem — used by the "errors only" filter. */
const HEALTHY_OUTCOMES = new Set<NetworkOutcome>(['ok', 'ws-connecting', 'ws-open', 'ws-frame']);

function outcomeTone(outcome: NetworkOutcome): BadgeTone {
  if (outcome === 'ok' || outcome === 'ws-open') return 'ok';
  if (outcome === 'rate-limited') return 'gold';
  if (outcome === 'ws-connecting' || outcome === 'ws-frame' || outcome === 'ws-closed') {
    return 'info';
  }
  return 'danger';
}

function statusTone(status: number | null): string {
  if (status === null) return 'text-ink-faint';
  if (status === 429) return 'text-warn';
  if (status < 300) return 'text-ok';
  return 'text-danger';
}

/** Strip the GGG host so the table shows just the path. */
function endpoint(url: string): string {
  return url.replace(/^[a-z]+:\/\/[^/]+/i, '') || url;
}

function DetailPanel({ entry }: { entry: NetworkLogEntry }) {
  const t = useT();
  return (
    <div className="mt-1.5 flex flex-col gap-1 border-t border-edge pt-1.5 text-xs">
      <div className="font-mono break-all text-ink-muted">{entry.url}</div>
      {entry.correlationId && (
        <div className="text-ink-faint">
          {t('network.correlationId')}: <span className="font-mono">{entry.correlationId}</span>
        </div>
      )}
      {entry.detail && (
        <div className="text-ink-muted">
          {t('network.detail')}: {entry.detail}
        </div>
      )}
      {entry.rateLimit && (
        <div>
          <div className="text-[0.6rem] tracking-widest text-ink-faint uppercase">
            {t('network.rateLimit')}
          </div>
          <ul className="mt-0.5 font-mono text-[0.65rem] text-ink-muted">
            {Object.entries(entry.rateLimit).map(([name, value]) => (
              <li key={name}>
                {name}: {value}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function NetworkPage() {
  const t = useT();
  const { networkEvents } = useEventStream();
  const [seed, setSeed] = useState<NetworkLogEntry[]>([]);
  const [logFilePath, setLogFilePath] = useState('');
  const [query, setQuery] = useState('');
  const [channel, setChannel] = useState('');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [paused, setPaused] = useState(false);
  const [frozen, setFrozen] = useState<NetworkLogEntry[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    apiGet<NetworkSnapshot>('/api/network')
      .then((snapshot) => {
        setSeed(snapshot.entries);
        setLogFilePath(snapshot.logFilePath);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), RELATIVE_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // Live stream (newest-first) merged with the initial snapshot, deduped by id.
  const merged = useMemo(() => {
    const byId = new Map<string, NetworkLogEntry>();
    for (const entry of networkEvents) byId.set(entry.id, entry);
    for (const entry of seed) byId.set(entry.id, entry);
    return [...byId.values()].sort((a, b) => b.at.localeCompare(a.at));
  }, [networkEvents, seed]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return merged.filter((entry) => {
      if (channel && entry.channel !== channel) return false;
      if (errorsOnly && HEALTHY_OUTCOMES.has(entry.outcome)) return false;
      if (
        needle &&
        !`${entry.url} ${entry.correlationId ?? ''} ${entry.detail ?? ''}`
          .toLowerCase()
          .includes(needle)
      ) {
        return false;
      }
      return true;
    });
  }, [merged, channel, errorsOnly, query]);

  // Pause freezes the list to the current snapshot so it stops jumping.
  const rows = paused && frozen ? frozen : filtered;

  const togglePause = useCallback(() => {
    setPaused((previous) => {
      const next = !previous;
      setFrozen(next ? filtered : null);
      return next;
    });
  }, [filtered]);

  function copyPath(): void {
    void navigator.clipboard?.writeText(logFilePath).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <section className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-lg font-semibold text-ink">{t('network.title')}</h1>
        <span className="text-xs text-ink-faint">{t('network.subtitle')}</span>
      </div>

      {logFilePath && (
        <div className="flex items-center gap-2 text-xs text-ink-muted">
          <span className="text-ink-faint">{t('network.logFile')}:</span>
          <span className="truncate font-mono">{logFilePath}</span>
          <Button variant="ghost" className="!px-1.5 !py-0.5 text-xs" onClick={copyPath}>
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? t('network.copied') : t('network.copyPath')}
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <TextInput
          value={query}
          onChange={(changeEvent) => setQuery(changeEvent.target.value)}
          placeholder={t('network.search')}
          className="w-64"
        />
        <Select
          ariaLabel={t('network.colChannel')}
          value={channel}
          onChange={setChannel}
          options={[
            { value: '', label: t('network.allChannels') },
            { value: 'http', label: 'HTTP' },
            { value: 'ws', label: 'WS' },
          ]}
          className="w-36"
        />
        <Switch checked={errorsOnly} onChange={setErrorsOnly} label={t('network.errorsOnly')} />
        <span className="text-xs text-ink-muted">{t('network.errorsOnly')}</span>
        <div className="flex-1" />
        <span className="text-xs text-ink-faint">
          {t('network.entriesShown', { count: rows.length })}
        </span>
        <Button variant="ghost" onClick={togglePause}>
          {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          {t('network.pause')}
        </Button>
        <Button variant="ghost" onClick={() => setSeed([])}>
          <Trash2 className="h-3.5 w-3.5" />
          {t('network.clear')}
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-ink-faint">{t('network.empty')}</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-surface-0 text-left text-[0.6rem] tracking-widest text-ink-faint uppercase">
              <tr>
                <th className="py-1 pr-2 font-semibold">{t('network.colTime')}</th>
                <th className="py-1 pr-2 font-semibold">{t('network.colMethod')}</th>
                <th className="py-1 pr-2 font-semibold">{t('network.colEndpoint')}</th>
                <th className="py-1 pr-2 font-semibold">{t('network.colPolicy')}</th>
                <th className="py-1 pr-2 text-right font-semibold">{t('network.colStatus')}</th>
                <th className="py-1 pr-2 text-right font-semibold">{t('network.colDuration')}</th>
                <th className="py-1 font-semibold">{t('network.colOutcome')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => {
                const expanded = expandedId === entry.id;
                return (
                  <tr
                    key={entry.id}
                    className="cursor-pointer border-t border-edge align-top hover:bg-surface-1"
                    onClick={() => setExpandedId(expanded ? null : entry.id)}
                  >
                    <td
                      className="py-1 pr-2 whitespace-nowrap text-ink-faint"
                      title={new Date(entry.at).toLocaleString()}
                    >
                      {t('network.ago', { value: formatRelativeMagnitude(entry.at, nowMs) })}
                    </td>
                    <td className="py-1 pr-2 font-mono whitespace-nowrap text-ink-muted">
                      <span className="text-ink-faint">{entry.channel === 'ws' ? '⇅ ' : ''}</span>
                      {entry.method}
                    </td>
                    <td className="max-w-0 py-1 pr-2">
                      <div className="truncate font-mono text-ink">{endpoint(entry.url)}</div>
                      {expanded && <DetailPanel entry={entry} />}
                    </td>
                    <td className="py-1 pr-2 whitespace-nowrap text-ink-faint">
                      {entry.policy ?? '—'}
                    </td>
                    <td
                      className={`py-1 pr-2 text-right font-mono whitespace-nowrap ${statusTone(entry.status)}`}
                    >
                      {entry.status ?? '—'}
                    </td>
                    <td className="py-1 pr-2 text-right font-mono whitespace-nowrap text-ink-faint">
                      {entry.durationMs === null ? '—' : `${entry.durationMs}ms`}
                    </td>
                    <td className="py-1">
                      <Badge tone={outcomeTone(entry.outcome)}>{entry.outcome}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
