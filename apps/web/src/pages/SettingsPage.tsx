import { useState, type FormEvent, type ReactNode } from 'react';
import { KeyRound, LogIn, ShieldCheck, Volume2 } from 'lucide-react';
import type { SessionPublicStatus } from '@poe-sniper/shared';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { Switch } from '../components/Switch';
import { TextInput } from '../components/TextInput';
import { useServerStatus } from '../hooks/useServerStatus';
import { ApiError, apiSend } from '../lib/api';
import { isHitSoundEnabled, playHitSound, setHitSoundEnabled } from '../lib/hit-sound';

function SettingsCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-edge bg-surface-1 p-4">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function SessionStatusLine({ session }: { session: SessionPublicStatus | undefined }) {
  if (!session?.hasSession) {
    return <p className="text-sm text-ink-faint">No session stored.</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
      <Badge
        tone={
          session.probedValid === true ? 'ok' : session.probedValid === false ? 'danger' : 'neutral'
        }
      >
        {session.probedValid === true
          ? 'logged in'
          : session.probedValid === false
            ? 'invalid'
            : 'not verified'}
      </Badge>
      {session.capturedAt && (
        <span className="text-xs">captured {new Date(session.capturedAt).toLocaleString()}</span>
      )}
      {session.cookieNames.map((cookieName) => (
        <Badge key={cookieName} tone="neutral">
          {cookieName}
        </Badge>
      ))}
    </div>
  );
}

export function SettingsPage() {
  const { status, refresh } = useServerStatus();
  const [poesessid, setPoesessid] = useState('');
  const [cfClearance, setCfClearance] = useState('');
  const [userAgent, setUserAgent] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(() => isHitSoundEnabled());

  function toggleSound(enabled: boolean): void {
    setHitSoundEnabled(enabled);
    setSoundEnabled(enabled);
    if (enabled) playHitSound();
  }

  async function run(action: () => Promise<string>): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const text = await action();
      setMessage({ tone: 'ok', text });
    } catch (error) {
      setMessage({
        tone: 'danger',
        text: error instanceof ApiError ? error.message : 'request failed',
      });
    } finally {
      setBusy(false);
      refresh();
    }
  }

  function pasteCookies(formEvent: FormEvent): void {
    formEvent.preventDefault();
    void run(async () => {
      const cookies: Record<string, string> = { POESESSID: poesessid.trim() };
      if (cfClearance.trim()) cookies['cf_clearance'] = cfClearance.trim();
      await apiSend('POST', '/api/session/cookies', {
        cookies,
        userAgent: userAgent.trim() || undefined,
      });
      setPoesessid('');
      setCfClearance('');
      const probed = await apiSend<SessionPublicStatus>('POST', '/api/session/probe');
      return probed.probedValid
        ? 'session saved and verified — logged in'
        : 'session saved but the login probe failed — cookies may be stale';
    });
  }

  return (
    <section className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-lg font-semibold text-ink">Settings</h1>

      <SettingsCard title="PoE session">
        <SessionStatusLine session={status?.session} />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="ghost"
            disabled={busy || !status?.session.hasSession}
            onClick={() => {
              void run(async () => {
                const probed = await apiSend<SessionPublicStatus>('POST', '/api/session/probe');
                return probed.probedValid ? 'logged in' : 'probe failed — session looks stale';
              });
            }}
          >
            <ShieldCheck className="h-4 w-4" />
            Verify session
          </Button>
          {confirmingClear ? (
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                setConfirmingClear(false);
                void run(async () => {
                  await apiSend('DELETE', '/api/session');
                  return 'session cleared';
                });
              }}
            >
              Confirm clear
            </Button>
          ) : (
            <Button
              variant="ghost"
              disabled={busy || !status?.session.hasSession}
              onClick={() => {
                setConfirmingClear(true);
                setTimeout(() => setConfirmingClear(false), 3000);
              }}
            >
              Clear session
            </Button>
          )}
        </div>
      </SettingsCard>

      <SettingsCard title="Log in with Path of Exile">
        <p className="text-sm text-ink-faint">
          One-click login on the real pathofexile.com page — credentials go only to GGG, the app
          captures the resulting cookies. Lands with session capture (web) and the desktop app.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <Button variant="primary" disabled title="Arrives in Phase 4 (web) / Phase 5 (desktop)">
            <LogIn className="h-4 w-4" />
            Log in with Path of Exile
          </Button>
          <Badge tone="info">phase 4/5</Badge>
        </div>
      </SettingsCard>

      <SettingsCard title="Paste cookies instead">
        <p className="text-sm text-ink-faint">
          Prefer not to log in inside the app? Copy the cookies from your own browser (devtools →
          Application → Cookies → pathofexile.com). Values are stored locally, never displayed and
          never logged.
        </p>
        <form onSubmit={pasteCookies} className="mt-3 flex flex-col gap-3">
          <Field label="POESESSID" hint="required">
            <TextInput
              type="password"
              value={poesessid}
              onChange={(changeEvent) => setPoesessid(changeEvent.target.value)}
              autoComplete="off"
              required
            />
          </Field>
          <Field label="cf_clearance" hint="optional — include if Cloudflare challenged you">
            <TextInput
              type="password"
              value={cfClearance}
              onChange={(changeEvent) => setCfClearance(changeEvent.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field
            label="User-Agent"
            hint="paste your browser's UA when cf_clearance is set (Cloudflare binds them)"
          >
            <TextInput
              value={userAgent}
              onChange={(changeEvent) => setUserAgent(changeEvent.target.value)}
              placeholder="leave empty for the server default"
            />
          </Field>
          <div className="flex items-center gap-3">
            <Button variant="primary" type="submit" disabled={busy || poesessid.trim() === ''}>
              <KeyRound className="h-4 w-4" />
              Save session
            </Button>
            {message && (
              <span className={`text-sm ${message.tone === 'ok' ? 'text-ok' : 'text-danger'}`}>
                {message.text}
              </span>
            )}
          </div>
        </form>
      </SettingsCard>

      <SettingsCard title="Alerts">
        <div className="flex items-center gap-3">
          <Switch checked={soundEnabled} onChange={toggleSound} label="Hit sound" />
          <span className="text-sm text-ink-muted">play a sound on every detected hit</span>
          <div className="flex-1" />
          <Button variant="ghost" onClick={playHitSound}>
            <Volume2 className="h-4 w-4" />
            Test
          </Button>
        </div>
        <p className="mt-2 text-xs text-ink-faint">
          Browsers unlock audio after the first interaction — hit Test once after opening the app.
        </p>
      </SettingsCard>

      <SettingsCard title="Rate-limit budgets">
        {status && Object.keys(status.rateLimit.policies).length > 0 ? (
          <ul className="flex flex-col gap-1 font-mono text-xs text-ink-muted">
            {Object.entries(status.rateLimit.policies).map(([policyKey, snapshot]) => (
              <li key={policyKey}>
                {policyKey}
                {snapshot.policyName && ` (${snapshot.policyName})`}:{' '}
                {snapshot.rules
                  .map(
                    (rule, index) =>
                      `${snapshot.states[index]?.maxHits ?? 0}/${rule.maxHits} per ${rule.periodSeconds}s`,
                  )
                  .join(' · ')}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-faint">
            No live data yet — budgets appear after the first GGG request (read from X-Rate-Limit
            headers, never hardcoded).
          </p>
        )}
      </SettingsCard>
    </section>
  );
}
