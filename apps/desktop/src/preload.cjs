// Sandboxed preload: flips the shell flag so the web build activates its
// desktop chrome (drag region, traffic-light inset) — see frontend.md — and
// exposes the narrow desktop-permissions bridge (prompt / open Settings pane).
// eslint-disable-next-line @typescript-eslint/no-require-imports -- sandboxed preload is CommonJS
const { contextBridge, ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.dataset.shell = 'desktop';
});

// Two fire-and-forget acts that HTTP can't do. Permission STATUS still flows
// over /api/status (single source of truth) — this bridge never returns it.
// Matches the DesktopPermissionsApi contract in @poe-sniper/shared.
contextBridge.exposeInMainWorld('desktopPermissions', {
  requestPermission: (kind) => ipcRenderer.send('permissions:request', kind),
  openSettingsPane: (kind) => ipcRenderer.send('permissions:open-pane', kind),
});

// Lets the renderer detect the OS without the deprecated navigator.platform.
contextBridge.exposeInMainWorld('systemInfo', { platform: process.platform });

// Price-check bridge (#37): the main process computes a result off the global
// hotkey and pushes it here; we re-dispatch it as a window event the
// usePriceCheck hook already listens for. Renderer stays sandboxed (no ipc).
ipcRenderer.on('price-check:result', (_event, result) => {
  window.dispatchEvent(new CustomEvent('sniper:price-check-result', { detail: { result } }));
});
