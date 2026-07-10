import { Navigate, Route, Routes } from 'react-router-dom';
import { NAV_ENTRIES } from './nav';
import { AppBar } from './AppBar';
import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { GuardBanner } from './GuardBanner';
import { LoginOverlay } from './LoginOverlay';
import { OnboardingWizard } from './OnboardingWizard';
import { SessionBanner } from './SessionBanner';
import { UpdateBanner } from './UpdateBanner';
import { IconRail } from './IconRail';
import { HitsPanel } from './HitsPanel';
import { PriceCheckPanel } from './PriceCheckPanel';
import { StatusBar } from './StatusBar';
import { ResizeHandle } from '../components/ResizeHandle';
import { useEventStream } from '../hooks/EventStreamProvider';
import { useHealth } from '../hooks/useHealth';
import { useHitsPanelLayout } from '../hooks/useHitsPanelLayout';
import { useOnboardingState } from '../hooks/useOnboardingState';
import { usePriceCheck } from '../hooks/usePriceCheck';
import { useSearches } from '../hooks/useSearches';
import { useServerStatus } from '../hooks/useServerStatus';
import { useUpdateCheck } from '../hooks/useUpdateCheck';
import { useNetworkViewEnabled } from '../hooks/useNetworkView';
import {
  HITS_PANEL_DEFAULT_WIDTH_PX,
  HITS_PANEL_KEYBOARD_STEP_PX,
  HITS_PANEL_MAX_WIDTH_PX,
  HITS_PANEL_MIN_WIDTH_PX,
  clampHitsPanelWidth,
  resetHitsPanelWidth,
  storeHitsPanelHidden,
  storeHitsPanelWidth,
} from '../lib/hits-panel-layout';
import { useT } from '../i18n/i18n';

export function AppShell() {
  const t = useT();
  const health = useHealth();
  const eventStream = useEventStream();
  const { status, refresh } = useServerStatus();
  const { searches } = useSearches();
  const update = useUpdateCheck();
  const networkViewEnabled = useNetworkViewEnabled();
  const hitsPanel = useHitsPanelLayout();
  const hitsPanelHidden = hitsPanel.hiddenAt !== null;
  const onboarding = useOnboardingState();
  // Split the column only when the panel sink is enabled AND a check is present
  // (result or in flight) — so price checks "appear" at the bottom on demand.
  const { result: priceCheckResult, checking: priceCheckChecking } = usePriceCheck();
  const priceCheckPanelVisible =
    (status?.settings.priceCheckSinks.includes('panel') ?? false) &&
    (priceCheckResult !== null || priceCheckChecking);

  // A drag previews the width by writing the CSS variable straight on the grid
  // node — no React re-render per pointer move (the whole app hangs off this
  // grid). The clamped value commits to the store on release.
  const gridRef = useRef<HTMLDivElement>(null);
  const pendingWidthRef = useRef<number | null>(null);
  function previewHitsPanelWidth(clientX: number): void {
    const width = clampHitsPanelWidth(window.innerWidth - clientX, window.innerWidth);
    gridRef.current?.style.setProperty('--hits-panel-width', `${width}px`);
    pendingWidthRef.current = width;
  }
  function commitHitsPanelWidth(): void {
    if (pendingWidthRef.current !== null) storeHitsPanelWidth(pendingWidthRef.current);
    pendingWidthRef.current = null;
  }
  function stepHitsPanelWidth(direction: 'left' | 'right'): void {
    // The panel sits on the right, so ArrowLeft = wider, ArrowRight = narrower.
    const delta = direction === 'left' ? HITS_PANEL_KEYBOARD_STEP_PX : -HITS_PANEL_KEYBOARD_STEP_PX;
    storeHitsPanelWidth(hitsPanel.widthPx + delta);
  }

  // Gold dot on the AppBar toggle: a NEW hit landed while the panel was hidden
  // (`hit` events only — lastHitAtBySearchId is not stamped by re-serves).
  const hiddenAt = hitsPanel.hiddenAt;
  const hasUnseenHits =
    hiddenAt !== null &&
    Object.values(eventStream.lastHitAtBySearchId).some((hitAt) => hitAt > hiddenAt);

  // Global detection posture for the app bar — derived from the live searches
  // list (refetched on every engine-status SSE event), so it follows ws→poll
  // demotions and re-promotions without its own polling.
  const detection = useMemo(() => {
    let ws = 0;
    let poll = 0;
    let total = 0;
    let degraded = 0;
    for (const search of searches) {
      if (!search.enabled) continue;
      total += 1;
      // The app-wide "something is wrong" beacon: sticky episodes + halted only
      // (review BEACON) — a transient governor blip must not light it.
      if (search.degradedSince !== null || search.status === 'halted') degraded += 1;
      if (search.status === 'stopped') continue;
      if (search.engine === 'ws') ws += 1;
      else if (search.engine === 'poll') poll += 1;
    }
    return { ws, poll, total, degraded };
  }, [searches]);

  // Live event wins; the status poll covers page loads after the trip.
  const guardTripped = eventStream.guard?.tripped ?? status?.guard.tripped ?? false;
  const sessionInvalid =
    (status?.session.hasSession ?? false) && status?.session.probedValid === false;
  // Boot login prompt: no session at all, or stored cookies failed the probe.
  const [loginOverlayDismissed, setLoginOverlayDismissed] = useState(false);
  const needsLogin =
    status !== null && (!status.session.hasSession || status.session.probedValid === false);

  return (
    <div
      ref={gridRef}
      style={{ '--hits-panel-width': `${hitsPanel.widthPx}px` } as CSSProperties}
      className={`grid h-full grid-rows-[2.5rem_auto_minmax(0,1fr)_2rem] grid-cols-[3rem_1fr] overflow-hidden ${
        hitsPanelHidden ? '' : 'lg:grid-cols-[3rem_1fr_var(--hits-panel-width)]'
      }`}
    >
      <header className="col-span-full">
        <AppBar
          serverHealthy={health.healthy}
          streamConnected={eventStream.connected}
          detection={detection}
          hitsPanelHidden={hitsPanelHidden}
          hasUnseenHits={hasUnseenHits}
          onToggleHitsPanel={() => storeHitsPanelHidden(!hitsPanelHidden)}
        />
      </header>

      <div className="col-span-full">
        {update?.updateAvailable && <UpdateBanner update={update} />}
        {guardTripped && <GuardBanner onReset={refresh} />}
        {sessionInvalid && <SessionBanner />}
      </div>

      <IconRail />

      {/* scrollbar-gutter: stable reserves the (themed, space-taking) scrollbar's
          width always, so expanding a group that adds the bar never shifts the
          column width. */}
      <main className="min-h-0 overflow-y-auto bg-surface-0 px-5 py-4 [scrollbar-gutter:stable]">
        <Routes>
          {NAV_ENTRIES.filter((entry) => !entry.devOnly || networkViewEnabled).map((entry) => (
            <Route key={entry.id} path={entry.path} element={<entry.page />} />
          ))}
          {/* Hidden dev routes (and any unknown path) redirect home — /network is
              not reachable by URL when the dev view is off (WEB-5). */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {!hitsPanelHidden && (
        /* overflow-hidden lives on the inner wrapper so the resize handle can
           overhang the border line without being clipped. */
        <aside className="relative hidden min-h-0 border-l border-edge bg-surface-1 lg:block">
          <ResizeHandle
            ariaLabel={t('hitsPanel.resize')}
            valueNow={hitsPanel.widthPx}
            valueMin={HITS_PANEL_MIN_WIDTH_PX}
            valueMax={HITS_PANEL_MAX_WIDTH_PX}
            onDragTo={previewHitsPanelWidth}
            onDragEnd={commitHitsPanelWidth}
            onKeyStep={stepHitsPanelWidth}
            onReset={() => {
              pendingWidthRef.current = null;
              gridRef.current?.style.setProperty(
                '--hits-panel-width',
                `${HITS_PANEL_DEFAULT_WIDTH_PX}px`,
              );
              resetHitsPanelWidth();
            }}
          />
          {/* When the price-check 'panel' sink is on AND a check is active, the
              column splits: live hits on top, price check on the bottom half
              (#37). Otherwise live hits gets the whole column. */}
          {priceCheckPanelVisible ? (
            <div className="grid h-full min-h-0 grid-rows-2">
              <div className="min-h-0 overflow-hidden">
                <HitsPanel onHide={() => storeHitsPanelHidden(true)} />
              </div>
              <div className="min-h-0 overflow-hidden border-t border-edge-strong">
                <PriceCheckPanel />
              </div>
            </div>
          ) : (
            <div className="h-full min-h-0 overflow-hidden">
              <HitsPanel onHide={() => storeHitsPanelHidden(true)} />
            </div>
          )}
        </aside>
      )}

      {/* First run: the wizard ABSORBS the login overlay (#36) — it embeds the
          same login flow and closing it counts as dismissing the overlay, so a
          user who skipped login isn't immediately re-prompted. */}
      {!onboarding.wizardDone ? (
        // Suppress the boot overlay only when login was actually skipped — a
        // user who logged in DURING the wizard should still get the blocking
        // re-prompt if the session later expires in this page session.
        <OnboardingWizard
          onClose={() => {
            if (needsLogin) setLoginOverlayDismissed(true);
          }}
        />
      ) : (
        needsLogin &&
        !loginOverlayDismissed && (
          <LoginOverlay
            expired={status.session.hasSession}
            onRefresh={refresh}
            onClose={() => setLoginOverlayDismissed(true)}
          />
        )
      )}

      <footer className="col-span-full">
        <StatusBar
          serverHealthy={health.healthy}
          serverVersion={health.version}
          serverStatus={status}
        />
      </footer>
    </div>
  );
}
