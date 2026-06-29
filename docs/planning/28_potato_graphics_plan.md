# 28 — PoE2 "potato graphics" trade-mode toggle

**Status: PARKED** (researched 2026-06-27 via a 4-agent workflow; not started — saved for
later at Bartosz's request). Pick this up before building; the research below is the value.

## Idea

A Settings toggle that prepares PoE2's graphics config for a low-spec "potato" profile so the
game is cheap to run while the app snipes — then restores the user's settings when toggled off.

## Two findings that reshape it (READ FIRST)

1. **A `poe-graphics` skill already exists** (`~/.claude/skills/poe-graphics/SKILL.md`) with a
   validated `potato` preset: in-place edit of `poe2_production_Config.ini`, **BOM-preserving**,
   backs up first, refuses to run while the client is open. This feature = **productize that
   skill's exact key set into the app**, not reinvent it.
2. **The game reads config at LAUNCH only and REWRITES it on EXIT.** So:
   - It can NOT be flipped live "during trading" — an edit while the game runs is clobbered on
     exit and can corrupt the file.
   - It's a **pre-launch toggle**: flip on → relaunch → trade → flip off → relaunch normal.
   - Star key: **`background_framerate_limit=5`** (+ `background_framerate_limit_enabled=true`,
     `mute_in_background=true`) — the game self-throttles to ~5 FPS while backgrounded (most of a
     sniping session). The real win; needs no live toggling.

## Portability (Bartosz's question: would it work on Windows / other MacBooks?)

**Yes — because it's an in-place per-machine TWEAK, never a file copy.** Potato KEYS are universal
(same names Win/Mac). **Never copy a whole config across machines** — `adapter_uid`/`adapter_name`/
`resolution_*`/`renderer_type` are hardware-bound; a foreign config can crash on launch or
black-screen (esp. the D3DMetal/Wine setup, where `fullscreen=true` black-screens). Only the
**path differs**: Windows `Documents\My Games\Path of Exile 2\` (resolve the Documents _Known
Folder_ — OneDrive may redirect it); Mac (CrossOver/Sikarugir) → `~/Documents/My Games/Path of
Exile 2/poe2_production_Config.ini` (the prefix's Documents is symlinked to the real `~/Documents`).

## Design

- **"PoE graphics (trade mode)"** Settings card.
- **Config path** field — auto-detect (Mac `~/Documents/…`; Windows Known Folder) + manual override,
  shown so the user can open/edit it by hand.
- **"Potato mode" toggle** — ON: back up the file, write potato keys in place; OFF: restore.
- **Backup**: timestamped sidecar file next to the config (survives app restarts), path tracked in
  settings.
- **Guardrails**: refuse to apply while the game is running (clobber/corruption); preserve UTF-8
  BOM + line endings; touch only portable quality/FPS keys + (restorable) resolution — NEVER
  `renderer_type`/`adapter_*`; note "takes effect on next launch".

## Architecture

- Server **`GraphicsProfileService`** using `node:fs` directly — **no new platform port** (file I/O
  is universal Node; works in `pnpm dev`, dev:desktop, packaged — unlike capture/input which need
  native macOS APIs). Testable with a temp dir.
- Extend `AppSettings` (`graphicsConfigPath`, `graphicsProfileActive`, `graphicsBackupPath`); reuse
  `/api/settings` PATCH + the status poll + the SettingsPage card pattern. EN/PL i18n.
- **Risk**: macOS `~/Documents` is TCC-protected — packaged Electron can be granted; the standalone
  `pnpm dev` node process may hit a permission prompt / `EPERM`. Handle gracefully + surface it.

## ToS caveat (hard-rule #2 territory)

Editing the local INI is community-considered safe (not memory/packet tampering) but is **not an
explicit GGG blessing** (one source: GGG "don't recommend modifying game files"; no known bans for
graphics-key edits). Add a one-line UI disclaimer; mark `TODO(verify)`. Bartosz's call.

## Decisions (defaults if resumed)

Mac-first (build+test on the Mac) with Windows path-detection coded but `TODO(verify)`; one fixed
"potato (trade)" preset for v1; pre-launch toggle gated to refuse while the game runs.

## Sources

GGG forum (config location); poecommunity.help (never edit while running); poe2-config-doctor
(safe-vs-ban-risk); switchbladegaming (read-at-launch/write-on-exit); CodeWeavers (Mac path); MS
Learn (OneDrive Known Folder); on-machine: `~/Documents/My Games/Path of Exile 2/poe2_production_Config.ini`,
the Sikarugir prefix symlinks, Vault `~/Vault/Notes/macos-gaming-wine/poe2_steam_sikarugir.md`, and
the `poe-graphics` skill (exact keys/BOM/renderer caveat).
