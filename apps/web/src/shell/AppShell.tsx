import { Route, Routes } from 'react-router-dom';
import { NAV_ENTRIES } from './nav';
import { AppBar } from './AppBar';
import { GuardBanner } from './GuardBanner';
import { SessionBanner } from './SessionBanner';
import { IconRail } from './IconRail';
import { HitsPanel } from './HitsPanel';
import { StatusBar } from './StatusBar';
import { useEventStream } from '../hooks/EventStreamProvider';
import { useHealth } from '../hooks/useHealth';
import { useServerStatus } from '../hooks/useServerStatus';

export function AppShell() {
  const health = useHealth();
  const eventStream = useEventStream();
  const { status, refresh } = useServerStatus();

  // Live event wins; the status poll covers page loads after the trip.
  const guardTripped = eventStream.guard?.tripped ?? status?.guard.tripped ?? false;
  const guardReason = eventStream.guard?.reason ?? status?.guard.reason ?? null;
  const sessionInvalid =
    (status?.session.hasSession ?? false) && status?.session.probedValid === false;

  return (
    <div className="grid h-screen grid-rows-[2.5rem_auto_1fr_2rem] grid-cols-[3rem_1fr] lg:grid-cols-[3rem_1fr_22rem]">
      <header className="col-span-full">
        <AppBar serverHealthy={health.healthy} streamConnected={eventStream.connected} />
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
