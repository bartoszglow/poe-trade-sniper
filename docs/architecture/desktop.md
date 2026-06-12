# Desktop shell (Electron)

One server, two shells (D-4): the Electron app boots the same NestJS server
**in its main process** and points a window at the loopback origin, which also
serves the built web UI (`STATIC_DIR` → `ServeStaticModule`). The renderer is
byte-identical to the browser build — relative `/api` URLs (D-9) make the
origin irrelevant.

## Modes

| Mode        | Command                                                     | Server                             | UI                                | Iteration                                                              |
| ----------- | ----------------------------------------------------------- | ---------------------------------- | --------------------------------- | ---------------------------------------------------------------------- |
| **dev**     | `pnpm dev` (root) + `pnpm --filter @poe-sniper/desktop dev` | tsx watch on :3500 (auto-restart)  | Vite :5180 (HMR)                  | instant — Electron is just a window; the embedded server is NOT booted |
| **preview** | `pnpm --filter @poe-sniper/desktop preview`                 | embedded in Electron main on :3580 | static build served by the server | full build; closest to the shipped app                                 |

Dev mode is selected by `SNIPER_DEV_URL` — when set, the main process skips
`startServer()` entirely and loads that URL.

## Data & lifecycle

- Preview/packaged runs own their data: `DB_PATH` defaults to
  `userData/sniper.db` (per-install), `PORT` to 3580 — a parallel web-dev
  stack on :3500 is never disturbed. Both are env-overridable.
- Single-instance lock; closing the last window **quits** (the sniper lives in
  this process — a hidden-but-running tray mode is a future idea).
- `before-quit` closes the Nest app (shutdown hooks stop engines and sockets).

## The better-sqlite3 ABI swap (known friction)

One compiled binary lives in `node_modules`; Node and Electron need different
ABIs. `pnpm --filter @poe-sniper/desktop abi:electron` / `abi:node` swap it
via prebuild-install (seconds, no compiler). `preview` runs the electron swap
automatically; **run `abi:node` before unit tests / web-dev** if a preview ran
last. Electron major is pinned to one with better-sqlite3 prebuilds
(41 / ABI 145 — Electron 42's V8 breaks the better-sqlite3 12.x source build).

**Packaging gotcha (bitten 2026-06-12):** electron-builder's own
@electron/rebuild step can silently no-op and pack whatever ABI currently
sits in `node_modules` — a node-ABI binary then ships inside `app.asar.unpacked`
and the packaged app dies on boot with `NODE_MODULE_VERSION 127 vs 145`.
The `dist` script therefore swaps explicitly: `abi:electron` **before**
electron-builder and `abi:node` after, so the working tree is always left
test-ready. If a packaged app fails to boot, check the ABI error in its
stdout first (run the binary in `Contents/MacOS/` directly).

## Deferred (full Phase 5)

Frameless window + custom title bar (the shell is ready — `data-shell`
switch), BrowserWindow login (D-12), tray mode, electron-builder packaging,
auto-update, icons/signing.
