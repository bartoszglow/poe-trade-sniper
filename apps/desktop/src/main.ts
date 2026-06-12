import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import type { RunningServer } from '@poe-sniper/server';

/**
 * Desktop shell (preliminary, D-4: one server, two shells): boots the NestJS
 * sniper server IN-PROCESS and points a window at the loopback origin — the
 * exact same build the browser uses (D-9: relative URLs).
 *
 * Deliberately deferred: frameless title bar, BrowserWindow login (Phase 4/5),
 * packaging. This shell is for `electron .` dev runs.
 */

const DEFAULT_DESKTOP_PORT = '3580';

/**
 * Dev mode: point the window at the Vite dev server (full HMR, server runs
 * under tsx watch via `pnpm dev` at the repo root) instead of booting the
 * embedded server. No builds, no sqlite ABI swap — Electron is just a window.
 */
const devUrl = process.env['SNIPER_DEV_URL'];

function configureEnvironment(): void {
  // Each desktop install owns its data; the dev stack on :3500 stays untouched.
  process.env['PORT'] ??= DEFAULT_DESKTOP_PORT;
  process.env['DB_PATH'] ??= join(app.getPath('userData'), 'sniper.db');
  // Unpackaged dev run: the web build sits next to this workspace package.
  process.env['STATIC_DIR'] ??= join(import.meta.dirname, '../../web/dist');
}

async function bootServer(): Promise<RunningServer> {
  configureEnvironment();
  // Import AFTER the environment is set — the server reads it at module load.
  const { startServer } = await import('@poe-sniper/server');
  return startServer();
}

function createWindow(url: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0b0a08',
    title: 'poe-trade-sniper',
  });
  void window.loadURL(url);
  return window;
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  let runningServer: RunningServer | null = null;
  let windowUrl = devUrl ?? '';

  app
    .whenReady()
    .then(async () => {
      if (!devUrl) {
        runningServer = await bootServer();
        windowUrl = `http://localhost:${runningServer.port}`;
      }
      createWindow(windowUrl);

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0 && windowUrl) {
          createWindow(windowUrl);
        }
      });
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      app.quit();
    });

  // The sniper lives in this process — closing the window stops detection,
  // so quit explicitly (macOS included) until a tray mode exists.
  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', () => {
    void runningServer?.app.close();
  });
}
