import { Route, Routes } from 'react-router-dom';
import { NAV_ENTRIES } from './nav';
import { AppBar } from './AppBar';
import { useMemo, useState } from 'react';
import { GuardBanner } from './GuardBanner';
import { LoginOverlay } from './LoginOverlay';
import { SessionBanner } from './SessionBanner';
import { IconRail } from './IconRail';
import { HitsPanel } from './HitsPanel';
import { StatusBar } from './StatusBar';
import { useEventStream } from '../hooks/EventStreamProvider';
import { useHealth } from '../hooks/useHealth';
import { useSearches } from '../hooks/useSearches';
import { useServerStatus } from '../hooks/useServerStatus';

export function AppShell() {
  const health = useHealth();
  const eventStream = useEventStream();
  const { status, refresh } = useServerStatus();
  const { searches } = useSearches();

  // Global detection posture for the app bar — derived from the live searches
  // list (refetched on every engine-status SSE event), so it follows ws→poll
  // demotions and re-promotions without its own polling.
  const detection = useMemo(() => {
    let ws = 0;
    let poll = 0;
    let total = 0;
    for (const search of searches) {
      if (!search.enabled) continue;
      total += 1;
      if (search.status === 'stopped') continue;
      if (search.engine === 'ws') ws += 1;
      else if (search.engine === 'poll') poll += 1;
    }
    return { ws, poll, total };
  }, [searches]);

  // Live event wins; the status poll covers page loads after the trip.
  const guardTripped = eventStream.guard?.tripped ?? status?.guard.tripped ?? false;
  const guardReason = eventStream.guard?.reason ?? status?.guard.reason ?? null;
  const sessionInvalid =
    (status?.session.hasSession ?? false) && status?.session.probedValid === false;
  // Boot login prompt: no session at all, or stored cookies failed the probe.
  const [loginOverlayDismissed, setLoginOverlayDismissed] = useState(false);
  const needsLogin =
    status !== null && (!status.session.hasSession || status.session.probedValid === false);

  return (
    <div className="grid h-screen grid-rows-[2.5rem_auto_1fr_2rem] grid-cols-[3rem_1fr] lg:grid-cols-[3rem_1fr_22rem]">
      <header className="col-span-full">
        <AppBar
          serverHealthy={health.healthy}
          streamConnected={eventStream.connected}
          detection={detection}
        />
      </header>

      <div className="col-span-full">
        {guardTripped && <GuardBanner reason={guardReason} onReset={refresh} />}
        {sessionInvalid && <SessionBanner />}
      </div>

      <IconRail />

      <main className="overflow-y-auto bg-surface-0 px-5 py-4">
        <Routes>
          {NAV_ENTRIES.map((entry) => (
            <Route key={entry.id} path={entry.path} element={<entry.page />} />
          ))}
        </Routes>
      </main>

      <aside className="hidden border-l border-edge bg-surface-1 lg:block">
        <HitsPanel />
      </aside>

      {needsLogin && !loginOverlayDismissed && (
        <LoginOverlay
          expired={status.session.hasSession}
          onRefresh={refresh}
          onClose={() => setLoginOverlayDismissed(true)}
        />
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
