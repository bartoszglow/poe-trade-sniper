import { Route, Routes } from 'react-router-dom';
import { NAV_ENTRIES } from './nav';
import { AppBar } from './AppBar';
import { IconRail } from './IconRail';
import { HitsPanel } from './HitsPanel';
import { StatusBar } from './StatusBar';
import { useHealth } from '../hooks/useHealth';

export function AppShell() {
  const health = useHealth();

  return (
    <div className="grid h-screen grid-rows-[2.5rem_1fr_2rem] grid-cols-[3rem_1fr] lg:grid-cols-[3rem_1fr_22rem]">
      <header className="col-span-full">
        <AppBar serverHealthy={health.healthy} />
      </header>

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
        <StatusBar serverHealthy={health.healthy} serverVersion={health.version} />
      </footer>
    </div>
  );
}
