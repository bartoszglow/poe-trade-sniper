import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { EventStreamProvider } from './hooks/EventStreamProvider';
import { ServerStatusProvider } from './hooks/useServerStatus';
import { I18nProvider } from './i18n/I18nProvider';
import { AppShell } from './shell/AppShell';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <I18nProvider>
        <EventStreamProvider>
          <ServerStatusProvider>
            <AppShell />
          </ServerStatusProvider>
        </EventStreamProvider>
      </I18nProvider>
    </BrowserRouter>
  </StrictMode>,
);
