import { useState, type FormEvent, type ReactNode } from 'react';
import { KeyRound, LogIn, ShieldCheck, Volume2 } from 'lucide-react';
import {
  PERMISSION_KINDS,
  describeState,
  type PermissionKind,
  type PermissionSeverity,
  type PermissionState,
  type PermissionsStatus,
  type SessionPublicStatus,
} from '@poe-sniper/shared';
import { Badge, type BadgeTone } from '../components/Badge';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { Select } from '../components/Select';
import { Slider } from '../components/Slider';
import { Switch } from '../components/Switch';
import { TextInput } from '../components/TextInput';
import { useServerStatus } from '../hooks/useServerStatus';
import { useLoginCapture } from '../hooks/useLoginCapture';
import { setNetworkViewEnabled, useNetworkViewEnabled } from '../hooks/useNetworkView';
import { LANGUAGES, useLanguage, useT, type Language } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';
import { ApiError, apiSend } from '../lib/api';
import {
  getHitSoundVolume,
  isHitSoundEnabled,
  playHitSound,
  setHitSoundEnabled,
  setHitSoundVolume,
} from '../lib/hit-sound';
import { isNotifyEnabled, setNotifyEnabled, showSystemNotification } from '../lib/notifications';

function SettingsCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-edge bg-surface-1 p-4">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function SessionStatusLine({ session }: { session: SessionPublicStatus | undefined }) {
  const t = useT();
  if (!session?.hasSession) {
    return <p className="text-sm text-ink-faint">{t('settings.noSession')}</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
      <Badge
        tone={
          session.probedValid === true ? 'ok' : session.probedValid === false ? 'danger' : 'neutral'
        }
      >
        {session.probedValid === true
          ? t('settings.loggedIn')
          : session.probedValid === false
            ? t('settings.invalid')
            : t('settings.notVerified')}
      </Badge>
      {session.capturedAt && (
        <span className="text-xs">
          {t('settings.captured', { date: new Date(session.capturedAt).toLocaleString() })}
        </span>
      )}
      {session.cookieNames.map((cookieName) => (
        <Badge key={cookieName} tone="neutral">
          {cookieName}
        </Badge>
      ))}
    </div>
  );
}

const PERMISSION_LABEL_KEYS: Record<PermissionKind, { name: MessageKey; desc: MessageKey }> = {
  screenRecording: {
    name: 'settings.permissions.screenRecording',
    desc: 'settings.permissions.screenRecordingDesc',
  },
  accessibility: {
    name: 'settings.permissions.accessibility',
    desc: 'settings.permissions.accessibilityDesc',
  },
};

const PERMISSION_STATE_KEYS: Record<PermissionState, MessageKey> = {
  granted: 'settings.permissions.granted',
  denied: 'settings.permissions.denied',
  'not-determined': 'settings.permissions.notDetermined',
  restricted: 'settings.permissions.restricted',
  unsupported: 'settings.permissions.unsupported',
};

const SEVERITY_TONES: Record<PermissionSeverity, BadgeTone> = {
  ok: 'ok',
  warn: 'info',
  danger: 'danger',
  muted: 'neutral',
};

/**
 * macOS-only permission controls (Option A): each row MIRRORS live OS status and
 * launches the grant/manage flow via the preload bridge — the app never writes
 * the permission itself, so the toggle flips only on the next status poll.
 */
function PermissionsCard({ permissions }: { permissions: PermissionsStatus }) {
  const t = useT();
  return (
    <SettingsCard title={t('settings.permissions.title')}>
      <p className="text-sm text-ink-faint">{t('settings.permissions.intro')}</p>
      <div className="mt-3 flex flex-col gap-3">
        {PERMISSION_KINDS.map((kind) => {
          const state = permissions[kind];
          const { granted, severity } = describeState(state);
          const unsupported = state === 'unsupported';
          return (
            <div key={kind} className="flex items-center gap-3">
              <Switch
                checked={granted}
                disabled={unsupported}
                label={t(PERMISSION_LABEL_KEYS[kind].name)}
                onChange={() => {
                  // Option A: never optimistic — kick off the OS flow; the toggle
                  // flips only when the next /api/status poll sees the new state.
                  if (granted) window.desktopPermissions?.openSettingsPane?.(kind);
                  else window.desktopPermissions?.requestPermission?.(kind);
                }}
              />
              <div className="min-w-0">
                <div className="text-sm text-ink">{t(PERMISSION_LABEL_KEYS[kind].name)}</div>
                <div className="text-xs text-ink-faint">{t(PERMISSION_LABEL_KEYS[kind].desc)}</div>
              </div>
              <div className="flex-1" />
              <Badge tone={SEVERITY_TONES[severity]}>{t(PERMISSION_STATE_KEYS[state])}</Badge>
            </div>
          );
        })}
      </div>
    </SettingsCard>
  );
}

export function SettingsPage() {
  const t = useT();
  const [language, setLanguage] = useLanguage();
  const { status, refresh } = useServerStatus();
  const [poesessid, setPoesessid] = useState('');
  const [cfClearance, setCfClearance] = useState('');
  const [userAgent, setUserAgent] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const networkViewEnabled = useNetworkViewEnabled();
  // macOS permission controls are desktop-only. Decision #1=A defers signing;
  // every current build is unsigned/dev, so we simply show on macOS desktop —
  // a release-time gate + stable signing land with Phase 5 packaging. (Not
  // coupled to the network-view flag: hiding the request log shouldn't hide this.)
  const isMacDesktop =
    window.systemInfo?.platform === 'darwin' &&
    document.documentElement.dataset['shell'] === 'desktop';
  const [soundEnabled, setSoundEnabled] = useState(() => isHitSoundEnabled());
  const [volume, setVolume] = useState(() => getHitSoundVolume());
  const [notifyEnabled, setNotifyEnabledState] = useState(() => isNotifyEnabled());
  const {
    loginState,
    loginDetail,
    start: startLoginCapture,
    cancel: cancelLoginCapture,
  } = useLoginCapture(refresh);

  function toggleSound(enabled: boolean): void {
    setHitSoundEnabled(enabled);
    setSoundEnabled(enabled);
    if (enabled) playHitSound();
  }

  function changeVolume(nextVolume: number): void {
    setHitSoundVolume(nextVolume);
    setVolume(nextVolume);
  }

  function toggleNotify(enabled: boolean): void {
    setNotifyEnabled(enabled);
    setNotifyEnabledState(enabled);
    if (enabled) showSystemNotification(t('notify.appName'), t('notify.enabled'));
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
        text: error instanceof ApiError ? error.message : t('common.requestFailed'),
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
      return probed.probedValid ? t('settings.savedVerified') : t('settings.savedUnverified');
    });
  }

  return (
    <section className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-lg font-semibold text-ink">{t('settings.title')}</h1>

      <SettingsCard title={t('settings.language')}>
        <div className="flex items-center gap-3">
          <Select
            ariaLabel={t('settings.language')}
            value={language}
            onChange={(nextLanguage) => setLanguage(nextLanguage as Language)}
            options={LANGUAGES.map((entry) => ({ value: entry.code, label: entry.label }))}
            className="w-40"
          />
          <span className="text-xs text-ink-faint">{t('settings.languageHint')}</span>
        </div>
      </SettingsCard>

      <SettingsCard title={t('settings.session')}>
        <SessionStatusLine session={status?.session} />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="ghost"
            disabled={busy || !status?.session.hasSession}
            onClick={() => {
              void run(async () => {
                const probed = await apiSend<SessionPublicStatus>('POST', '/api/session/probe');
                return probed.probedValid ? t('settings.loggedIn') : t('settings.probeFailed');
              });
            }}
          >
            <ShieldCheck className="h-4 w-4" />
            {t('settings.verify')}
          </Button>
          {confirmingClear ? (
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                setConfirmingClear(false);
                void run(async () => {
                  await apiSend('DELETE', '/api/session');
                  return t('settings.cleared');
                });
              }}
            >
              {t('settings.confirmClear')}
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
              {t('settings.clear')}
            </Button>
          )}
        </div>
      </SettingsCard>

      <SettingsCard title={t('settings.loginCard')}>
        <p className="text-sm text-ink-faint">{t('settings.loginCardBody')}</p>
        <div className="mt-3 flex items-center gap-3">
          <Button
            variant="primary"
            disabled={loginState === 'waiting-login'}
            onClick={startLoginCapture}
          >
            <LogIn className="h-4 w-4" />
            {t('login.withPoe')}
          </Button>
          {loginState === 'waiting-login' && (
            <>
              <Badge tone="gold">{t('login.waiting')}</Badge>
              <Button variant="ghost" onClick={cancelLoginCapture}>
                {t('common.cancel')}
              </Button>
            </>
          )}
          {loginDetail && <span className="text-xs text-ink-faint">{loginDetail}</span>}
        </div>
      </SettingsCard>

      <SettingsCard title={t('settings.pasteCard')}>
        <p className="text-sm text-ink-faint">{t('settings.pasteCardBody')}</p>
        <form onSubmit={pasteCookies} className="mt-3 flex flex-col gap-3">
          <Field label="POESESSID" hint={t('settings.hintRequired')}>
            <TextInput
              type="password"
              value={poesessid}
              onChange={(changeEvent) => setPoesessid(changeEvent.target.value)}
              autoComplete="off"
              required
            />
          </Field>
          <Field label="cf_clearance" hint={t('settings.hintCfClearance')}>
            <TextInput
              type="password"
              value={cfClearance}
              onChange={(changeEvent) => setCfClearance(changeEvent.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field label="User-Agent" hint={t('settings.hintUserAgent')}>
            <TextInput
              value={userAgent}
              onChange={(changeEvent) => setUserAgent(changeEvent.target.value)}
              placeholder={t('settings.uaPlaceholder')}
            />
          </Field>
          <div className="flex items-center gap-3">
            <Button variant="primary" type="submit" disabled={busy || poesessid.trim() === ''}>
              <KeyRound className="h-4 w-4" />
              {t('settings.saveSession')}
            </Button>
            {message && (
              <span className={`text-sm ${message.tone === 'ok' ? 'text-ok' : 'text-danger'}`}>
                {message.text}
              </span>
            )}
          </div>
        </form>
      </SettingsCard>

      <SettingsCard title={t('settings.alerts')}>
        <div className="flex items-center gap-3">
          <Switch checked={soundEnabled} onChange={toggleSound} label={t('settings.hitSound')} />
          <span className="text-sm text-ink-muted">{t('settings.hitSoundDesc')}</span>
          <div className="flex-1" />
          <Button
            variant="ghost"
            onClick={() => {
              playHitSound();
              showSystemNotification(t('notify.appName'), t('notify.testBody'));
            }}
          >
            <Volume2 className="h-4 w-4" />
            {t('common.test')}
          </Button>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <span className="text-sm text-ink-muted">{t('settings.volume')}</span>
          <Slider
            value={volume}
            onChange={changeVolume}
            onCommit={() => {
              if (soundEnabled) playHitSound();
            }}
            label={t('settings.volume')}
            disabled={!soundEnabled}
            className="w-48"
          />
          <span className="w-10 font-mono text-xs text-ink-faint">{volume}%</span>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Switch
            checked={notifyEnabled}
            onChange={toggleNotify}
            label={t('settings.systemNotifications')}
          />
          <span className="text-sm text-ink-muted">{t('settings.systemNotificationsDesc')}</span>
        </div>
        <p className="mt-2 text-xs text-ink-faint">{t('settings.audioUnlockNote')}</p>
      </SettingsCard>

      {isMacDesktop && status && <PermissionsCard permissions={status.permissions} />}

      <SettingsCard title={t('settings.developer')}>
        <div className="flex items-center gap-3">
          <Switch
            checked={networkViewEnabled}
            onChange={setNetworkViewEnabled}
            label={t('settings.networkView')}
          />
          <span className="text-sm text-ink-muted">{t('settings.networkViewDesc')}</span>
        </div>
      </SettingsCard>

      <SettingsCard title={t('settings.budgets')}>
        {status && Object.keys(status.rateLimit.policies).length > 0 ? (
          <ul className="flex flex-col gap-1 font-mono text-xs text-ink-muted">
            {Object.entries(status.rateLimit.policies).map(([policyKey, snapshot]) => (
              <li key={policyKey}>
                {policyKey}
                {snapshot.policyName && ` (${snapshot.policyName})`}:{' '}
                {snapshot.rules
                  .map((rule, index) =>
                    t('settings.budgetRule', {
                      used: snapshot.states[index]?.maxHits ?? 0,
                      max: rule.maxHits,
                      period: rule.periodSeconds,
                    }),
                  )
                  .join(' · ')}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-faint">{t('settings.budgetsEmpty')}</p>
        )}
      </SettingsCard>
    </section>
  );
}
