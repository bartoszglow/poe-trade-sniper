import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, nativeImage, shell } from 'electron';
import type { DesktopPlatform, RunningServer, StartServerOptions } from '@poe-sniper/server';
import { createDesktopPlatform } from './platform/build-desktop-platform.js';
import { registerPermissionsIpc } from './ipc/permissions.ipc.js';

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
  // Redacted GGG network log — a user can share this file for debugging.
  process.env['LOG_DIR'] ??= join(app.getPath('logs'), 'network');
  // In-app update check: only the packaged desktop app polls GitHub Releases.
  // Dev/web/test stay dormant (no GITHUB_RELEASES_REPO → no outbound check).
  if (app.isPackaged) process.env['GITHUB_RELEASES_REPO'] ??= 'bartoszglow/poe-trade-sniper';
  if (app.isPackaged) {
    process.env['STATIC_DIR'] ??= join(process.resourcesPath, 'web');
    process.env['MIGRATIONS_DIR'] ??= join(process.resourcesPath, 'migrations');
    process.env['LOGIN_PROFILE_DIR'] ??= app.getPath('userData');
  } else {
    // Unpackaged dev run: the web build sits next to this workspace package.
    process.env['STATIC_DIR'] ??= join(import.meta.dirname, '../../web/dist');
  }
}

async function bootServer(platform: DesktopPlatform): Promise<RunningServer> {
  configureEnvironment();
  // Inject the real desktop adapters (permissions now; capture/input in Phase 2)
  // BEFORE the server boots, so DI holds them from the first request.
  const options: StartServerOptions = { platformFactory: () => platform };
  // Import AFTER the environment is set — the server reads it at module load.
  // Packaged: the esbuild CJS bundle; dev: the workspace package.
  if (app.isPackaged) {
    const { createRequire } = await import('node:module');
    const requireCjs = createRequire(import.meta.url);
    // dist/main.js → ../bundle/server.cjs at the asar root.
    const bundled = requireCjs('../bundle/server.cjs') as {
      startServer: (options?: StartServerOptions) => Promise<RunningServer>;
    };
    return bundled.startServer(options);
  }
  const { startServer } = await import('@poe-sniper/server');
  return startServer(options);
}

/**
 * Set the macOS dock icon to our brand mark. Packaged builds already get it
 * from the app bundle (electron-builder picks up build/icon.icns); this covers
 * the `electron .` dev run, where the dock would otherwise show the generic
 * Electron icon.
 */
function applyDockIcon(): void {
  if (process.platform !== 'darwin' || !app.dock) return;
  // dist/main.js → ../assets/icon.png in this package.
  const iconPath = join(import.meta.dirname, '../assets/icon.png');
  if (!existsSync(iconPath)) return;
  const icon = nativeImage.createFromPath(iconPath);
  if (!icon.isEmpty()) app.dock.setIcon(icon);
}

function createWindow(url: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0b0a08',
    title: 'poe-trade-sniper',
    // D-8: our app bar IS the title bar; macOS traffic lights overlay it.
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(import.meta.dirname, 'preload.cjs'),
      // Renderer is plain web content — no Node access, fully sandboxed.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // The renderer never navigates away, but http(s) links (e.g. the update
  // download) open in the user's real browser instead of a child window.
  window.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (/^https?:\/\//.test(targetUrl)) void shell.openExternal(targetUrl);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (navigationEvent, targetUrl) => {
    // Compare parsed ORIGINS, not a string prefix — a prefix would let through
    // userinfo tricks like http://localhost:PORT@evil.com (SEC-4).
    try {
      if (new URL(targetUrl).origin !== new URL(url).origin) navigationEvent.preventDefault();
    } catch {
      navigationEvent.preventDefault(); // unparseable target → block
    }
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
      applyDockIcon();
      // The permission probe lives in the Electron main; build it once and (a)
      // wire the request/open-pane IPC (works in dev AND packaged) and (b) inject
      // it into the in-process server when we boot one (preview/packaged). In dev
      // the window points at the standalone server, which keeps the no-op probe.
      const platform = createDesktopPlatform();
      registerPermissionsIpc(platform.permissionProbe);
      if (!devUrl) {
        runningServer = await bootServer(platform);
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

  let quitting = false;
  app.on('before-quit', (quitEvent) => {
    // Dev mode points the window at the standalone server → nothing to close here.
    if (quitting || !runningServer) return;
    // Otherwise hold the quit until the in-process server's shutdown hooks finish
    // (engines stopped, sockets terminated, DB closed), then exit (REL-6).
    quitting = true;
    quitEvent.preventDefault();
    void runningServer.app
      .close()
      .catch(() => undefined)
      .finally(() => app.exit(0));
  });
}
