---
type: project
status: done
tags: [poe2, sniper, phase5, electron, packaging]
created: 2026-06-12
updated: 2026-06-12
---

# Phase 5 — Desktop full (detailed plan)

> **SHIPPED 2026-06-12** (tip eae9c11): frameless + preload data-shell,
> esbuild CJS server bundle, electron-builder dmg (arm64, unsigned) — packaged
> app verified booting: health OK, migrations from resources, UI served.
> Deferred: signing/notarization, tray, auto-update, Win/Linux.

Foundation (5a) shipped earlier: embedded server, dev/preview modes, ABI swap,
renderer hardening. Remaining to "real app":

1. **Frameless shell** — `titleBarStyle: hiddenInset` (macOS traffic lights
   overlay), preload sets `data-shell="desktop"` → app bar becomes the drag
   region (CSS shipped in Phase 0/D-8), traffic-light inset padding.
2. **Packaging (.dmg, arm64)** — server bundled to one CJS file with esbuild
   (possible thanks to D-11: no decorator metadata needed), web dist +
   migrations as extraResources, better-sqlite3 as the only native dep
   (electron-builder rebuilds it for Electron — ends the ABI swap for
   packaged builds). `MIGRATIONS_DIR` env override in the migrator (bundle
   loses `import.meta.url` anchoring).
3. **Login on desktop** — decision: the Phase 4 CDP capture (system Chrome)
   works identically from the packaged app; Electron-native BrowserWindow
   login parked as a variant for machines without Chrome.

Deferred: signing/notarization, auto-update, tray mode, Win/Linux targets.

> **DoD:** `pnpm --filter @poe-sniper/desktop dist` produces a .dmg; the
> installed app boots, serves its UI frameless, watches searches against its
> own userData DB.
