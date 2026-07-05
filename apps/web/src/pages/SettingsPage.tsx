import { useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import {
  Download,
  GraduationCap,
  KeyRound,
  LogIn,
  ShieldCheck,
  Upload,
  Volume2,
} from 'lucide-react';
import {
  DEAL_MAX_WATCHES_MAX,
  DEAL_MAX_WATCHES_MIN,
  DEFAULT_DEAL_MAX_WATCHES,
  DEFAULT_PRICE_CHECK_HOTKEY,
  DEFAULT_RATE_LIMIT_AGGRESSIVENESS,
  PERMISSION_KINDS,
  PRICE_CHECK_SINK_OPTIONS,
  RATE_LIMIT_AGGRESSIVENESS_MAX,
  RATE_LIMIT_AGGRESSIVENESS_MIN,
  RATE_LIMIT_AGGRESSIVENESS_SAFE_MAX,
  describeState,
  type AppSettings,
  type ImportResult,
  type PermissionKind,
  type PermissionSeverity,
  type PermissionState,
  type PermissionsStatus,
  type PriceCheckSink,
  type SessionPublicStatus,
} from '@poe-sniper/shared';
import { Badge, type BadgeTone } from '../components/Badge';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { HotkeyRecorder } from '../components/HotkeyRecorder';
import { PriceCheckResultView } from '../components/PriceCheckResultView';
import { Select } from '../components/Select';
import { Slider } from '../components/Slider';
import { Switch } from '../components/Switch';
import { TextInput } from '../components/TextInput';
import { useServerStatus } from '../hooks/useServerStatus';
import { useLoginCapture } from '../hooks/useLoginCapture';
import { usePriceCheck } from '../hooks/usePriceCheck';
import { setOnboardingDone } from '../lib/onboarding';
import { setNetworkViewEnabled, useNetworkViewEnabled } from '../hooks/useNetworkView';
import { LANGUAGES, useLanguage, useT, type Language } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';
import { ApiError, apiSend } from '../lib/api';
import { downloadFile, readJsonFile } from '../lib/data-transfer';
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

/**
 * How many searches may run deal watch at once (D-dw-17). The number commits on
 * blur/Enter, clamped to [MIN, MAX]. Raising it resumes parked watches server-
 * side without a restart; the hint explains the concurrent-socket tradeoff.
 */
function DealWatchLimitCard({
  settings,
  onChanged,
}: {
  settings: AppSettings | undefined;
  onChanged: () => void;
}) {
  const t = useT();
  const current = settings?.dealMaxWatches ?? DEFAULT_DEAL_MAX_WATCHES;
  const [draft, setDraft] = useState<string>(String(current));

  // Follow the server value when it changes elsewhere and the field isn't being edited.
  const syncedRef = useRef(current);
  if (syncedRef.current !== current) {
    syncedRef.current = current;
    setDraft(String(current));
  }

  function commit(): void {
    const parsed = Math.round(Number(draft));
    if (!Number.isFinite(parsed)) {
      setDraft(String(current));
      return;
    }
    const clamped = Math.min(DEAL_MAX_WATCHES_MAX, Math.max(DEAL_MAX_WATCHES_MIN, parsed));
    setDraft(String(clamped));
    if (clamped !== current) {
      void apiSend('PATCH', '/api/settings', { dealMaxWatches: clamped }).then(onChanged);
    }
  }

  return (
    <SettingsCard title={t('settings.dealWatchLimit')}>
      <div className="flex flex-wrap items-center gap-3">
        <Field label={t('settings.dealWatchLimitLabel')}>
          <TextInput
            type="number"
            inputMode="numeric"
            min={DEAL_MAX_WATCHES_MIN}
            max={DEAL_MAX_WATCHES_MAX}
            value={draft}
            onChange={(changeEvent) => setDraft(changeEvent.target.value)}
            onBlur={commit}
            onKeyDown={(keyEvent) => {
              if (keyEvent.key === 'Enter') keyEvent.currentTarget.blur();
            }}
            className="w-24"
          />
        </Field>
        <span className="max-w-md text-xs text-ink-faint">{t('settings.dealWatchLimitHint')}</span>
      </div>
    </SettingsCard>
  );
}

function RateLimitCard({
  settings,
  onChanged,
}: {
  settings: AppSettings | undefined;
  onChanged: () => void;
}) {
  const t = useT();
  const current = settings?.rateLimitAggressiveness ?? DEFAULT_RATE_LIMIT_AGGRESSIVENESS;
  const [draft, setDraft] = useState<number>(current);

  // Follow the server value when it changes elsewhere and the slider isn't being dragged.
  const syncedRef = useRef(current);
  if (syncedRef.current !== current) {
    syncedRef.current = current;
    setDraft(current);
  }

  function commit(): void {
    if (draft !== current) {
      void apiSend('PATCH', '/api/settings', { rateLimitAggressiveness: draft }).then(onChanged);
    }
  }

  const riskZone = draft > RATE_LIMIT_AGGRESSIVENESS_SAFE_MAX;
  return (
    <SettingsCard title={t('settings.rateLimit')}>
      <div className="flex items-center gap-3">
        <Slider
          value={draft}
          onChange={setDraft}
          onCommit={commit}
          label={t('settings.rateLimitLabel')}
          min={RATE_LIMIT_AGGRESSIVENESS_MIN}
          max={RATE_LIMIT_AGGRESSIVENESS_MAX}
          className="max-w-xs flex-1"
        />
        <span
          className={`w-14 text-right font-mono text-sm ${riskZone ? 'text-warn' : 'text-gold-bright'}`}
        >
          {draft}%
        </span>
      </div>
      <p className={`mt-2 max-w-md text-xs ${riskZone ? 'text-warn' : 'text-ink-faint'}`}>
        {riskZone ? t('settings.rateLimitRisk') : t('settings.rateLimitHint')}
      </p>
    </SettingsCard>
  );
}

/** Price-check settings (#37): hotkey, result-surface toggles, and a paste box
 *  that also serves as the dev/web way to run a check without the game. */
function PriceCheckCard({
  settings,
  onChanged,
}: {
  settings: AppSettings | undefined;
  onChanged: () => void;
}) {
  const t = useT();
  const { check, checking, result, error } = usePriceCheck();
  const [pasteText, setPasteText] = useState('');
  const sinks = settings?.priceCheckSinks ?? [];

  function patch(body: Partial<AppSettings>): void {
    void apiSend('PATCH', '/api/settings', body).then(onChanged);
  }

  function toggleSink(sink: PriceCheckSink, enabled: boolean): void {
    const next = enabled ? [...new Set([...sinks, sink])] : sinks.filter((entry) => entry !== sink);
    patch({ priceCheckSinks: next });
  }

  return (
    <SettingsCard title={t('settings.priceCheck')}>
      <p className="text-sm text-ink-faint">{t('settings.priceCheckDesc')}</p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Field label={t('settings.priceCheckHotkey')}>
          <HotkeyRecorder
            value={settings?.priceCheckHotkey ?? DEFAULT_PRICE_CHECK_HOTKEY}
            defaultValue={DEFAULT_PRICE_CHECK_HOTKEY}
            onChange={(accelerator) => patch({ priceCheckHotkey: accelerator })}
          />
        </Field>
        <span className="text-xs text-ink-faint">{t('settings.priceCheckHotkeyHint')}</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4">
        <span className="text-xs text-ink-muted">{t('settings.priceCheckSinks')}</span>
        {PRICE_CHECK_SINK_OPTIONS.map((sink) => (
          <span key={sink} className="flex items-center gap-1.5 text-xs text-ink-muted">
            <Switch
              checked={sinks.includes(sink)}
              onChange={(enabled) => toggleSink(sink, enabled)}
              label={t(
                sink === 'panel'
                  ? 'settings.priceCheckSinkPanel'
                  : 'settings.priceCheckSinkOverlay',
              )}
            />
            {t(
              sink === 'panel' ? 'settings.priceCheckSinkPanel' : 'settings.priceCheckSinkOverlay',
            )}
          </span>
        ))}
      </div>

      <div className="mt-4">
        <Field label={t('settings.priceCheckPaste')} hint={t('settings.priceCheckPasteHint')}>
          <textarea
            value={pasteText}
            onChange={(changeEvent) => setPasteText(changeEvent.target.value)}
            rows={4}
            placeholder={t('settings.priceCheckPastePlaceholder')}
            className="w-full rounded-md border border-edge bg-surface-2 px-2.5 py-1.5 font-mono text-xs text-ink placeholder:text-ink-faint focus:border-gold focus:outline-none"
          />
        </Field>
        <div className="mt-2">
          <Button
            variant="primary"
            disabled={checking || pasteText.trim() === ''}
            onClick={() => void check(pasteText)}
          >
            {checking ? t('priceCheck.checking') : t('settings.priceCheckRun')}
          </Button>
        </div>
        {/* Inline result — the test bench must show its answer here, not only in
            the lg+ side panel (which may be hidden or off). */}
        {error && <p className="mt-2 text-xs text-danger">{t('common.requestFailed')}</p>}
        {result && (
          <div className="mt-3 rounded-md border border-edge bg-surface-2 p-3">
            <PriceCheckResultView result={result} maxListings={5} />
          </div>
        )}
      </div>
    </SettingsCard>
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
  // "Logged in" = a stored session that hasn't failed the probe (null = not yet
  // probed → treat as logged in; the boot probe settles it in a few seconds).
  // When logged in we hide the login/paste cards and offer logout instead.
  const loggedIn = (status?.session.hasSession ?? false) && status?.session.probedValid !== false;
  const [poesessid, setPoesessid] = useState('');
  const [cfClearance, setCfClearance] = useState('');
  const [userAgent, setUserAgent] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [dataMessage, setDataMessage] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(
    null,
  );
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
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
        text:
          error instanceof ApiError && error.userFacing ? error.message : t('common.requestFailed'),
      });
    } finally {
      setBusy(false);
      refresh();
    }
  }

  function importSearches(changeEvent: ChangeEvent<HTMLInputElement>): void {
    const file = changeEvent.target.files?.[0];
    changeEvent.target.value = ''; // allow re-picking the same file
    if (!file) return;
    setImporting(true);
    setDataMessage(null);
    void (async () => {
      let envelope: unknown;
      try {
        envelope = await readJsonFile(file);
      } catch {
        setDataMessage({ tone: 'danger', text: t('settings.importBadFile') });
        setImporting(false);
        return;
      }
      try {
        const result = await apiSend<ImportResult>('POST', '/api/import/searches', envelope);
        const summary = t('settings.importDone', {
          imported: result.imported,
          skipped: result.skipped,
        });
        setDataMessage({
          tone: 'ok',
          text:
            result.errors.length > 0
              ? `${summary} · ${result.errors.length} ${t('settings.importErrors')}`
              : summary,
        });
      } catch (error) {
        // Show the server's message only when it's an intended user-facing one;
        // never the raw route+status fallback.
        setDataMessage({
          tone: 'danger',
          text:
            error instanceof ApiError && error.userFacing
              ? error.message
              : t('common.requestFailed'),
        });
      } finally {
        setImporting(false);
      }
    })();
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
        <div className="flex flex-wrap items-center gap-3">
          <Select
            ariaLabel={t('settings.language')}
            value={language}
            onChange={(nextLanguage) => setLanguage(nextLanguage as Language)}
            options={LANGUAGES.map((entry) => ({ value: entry.code, label: entry.label }))}
            className="w-40"
          />
          <span className="text-xs text-ink-faint">{t('settings.languageHint')}</span>
          <div className="flex-1" />
          <Button variant="ghost" onClick={() => setOnboardingDone(false)}>
            <GraduationCap className="h-4 w-4" />
            {t('onboarding.showIntro')}
          </Button>
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
              {/* Logout = removing the stored cookie locally; we deliberately do
                  NOT hit GGG's logout (that would also log the operator out of
                  their real browser and adds needless GGG traffic). */}
              {loggedIn ? t('settings.confirmLogout') : t('settings.confirmClear')}
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
              {loggedIn ? t('settings.logout') : t('settings.clear')}
            </Button>
          )}
        </div>
      </SettingsCard>

      {/* Login + cookie-paste only matter when NOT logged in — hide once a valid
          session exists (the operator uses Log out above to switch accounts). */}
      {!loggedIn && (
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
      )}

      {!loggedIn && (
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
      )}

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

      <SettingsCard title={t('settings.cursor')}>
        <div className="flex flex-wrap items-center gap-3">
          <Select
            ariaLabel={t('settings.cursor')}
            value={status?.settings.cursorMode ?? 'instant'}
            onChange={(mode) => {
              void apiSend('PATCH', '/api/settings', { cursorMode: mode }).then(refresh);
            }}
            options={[
              { value: 'instant', label: t('settings.cursorInstant') },
              { value: 'smooth', label: t('settings.cursorSmooth') },
            ]}
            className="w-56"
          />
          <span className="text-xs text-ink-faint">{t('settings.cursorHint')}</span>
        </div>
      </SettingsCard>

      <DealWatchLimitCard settings={status?.settings} onChanged={refresh} />

      <RateLimitCard settings={status?.settings} onChanged={refresh} />

      <PriceCheckCard settings={status?.settings} onChanged={refresh} />

      <SettingsCard title={t('settings.data')}>
        <p className="text-sm text-ink-faint">{t('settings.dataDesc')}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            onClick={() => downloadFile('/api/export/searches', 'poe-sniper-searches.json')}
          >
            <Download className="h-4 w-4" />
            {t('settings.exportSearches')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => downloadFile('/api/export/hits', 'poe-sniper-hits.csv')}
          >
            <Download className="h-4 w-4" />
            {t('settings.exportHits')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => downloadFile('/api/export/activity', 'poe-sniper-activity.csv')}
          >
            <Download className="h-4 w-4" />
            {t('settings.exportActivity')}
          </Button>
          <Button
            variant="primary"
            disabled={importing}
            onClick={() => importInputRef.current?.click()}
          >
            <Upload className="h-4 w-4" />
            {t('settings.importSearches')}
          </Button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={importSearches}
          />
          {dataMessage && (
            <span className={`text-sm ${dataMessage.tone === 'ok' ? 'text-ok' : 'text-danger'}`}>
              {dataMessage.text}
            </span>
          )}
        </div>
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
