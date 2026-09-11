# CLAUDE.md — poe-trade-sniper session manifest

Read this first, every session.

## Hard rules

1. **The old poe2-live-sniper prototype has been retired** — cutover is done;
   this is the sole sniper. (Removed in the 2026-06 Workspaces restructure.)
2. **No guessing about the GGG API.** It is undocumented. Discovered behaviour
   → `docs/integration/api-notes.md` with evidence + date; assumptions in code
   marked `TODO(verify)`.
3. **The PoE session is a credential.** Cookies/UA: never logged, never
   returned by the API, never committed, never shown in the UI.
4. **All GGG traffic goes through `apps/server/src/trade-api/`** and the
   rate-limit governor. No `fetch` to pathofexile.com anywhere else — the
   governor is load-bearing (lockouts stack).
5. **Auto-travel is explicit per-search opt-in** — it teleports the real
   character. Never default it on.
6. `pnpm verify` green before every commit. Stage files with explicit full
   paths (never `git add -A`/`.`); verify `git show --stat HEAD` after.
7. English everywhere (code, comments, commits, docs). No `Co-Authored-By`
   lines in commits.
8. Never run e2e or manual tests against live GGG endpoints — recorded/mock
   fixtures only.

## Orientation

- Architecture + layering: `docs/architecture/architecture.md`
- Frontend shell rules: `docs/architecture/frontend.md`
- Conventions + quality gates: `docs/process/conventions.md`
- Dev quickstart: `docs/operations/run.md`
- **Planning, phases, decisions** (master plan, decisions log, open
  questions): `docs/planning/`

## State of the build

_Last synced 2026-07-17. This section describes what the app IS; the history of
how it got there lives in `CHANGELOG.md` and `docs/planning/`._

### What exists today

**All phases (0–5) are shipped.** The app is a working Electron desktop sniper:
detection → deal watch → travel → buy automation, with a full operator UI in
English and Polish. `pnpm verify` green (server 444 · web 176 · desktop 11).
Version is still `0.1.0` and **nothing has ever been tagged or released** —
`CHANGELOG.md` `[Unreleased]` holds everything since 2026-06-13.

- **Detection** — ONE persistent WS socket per search (like a browser tab); the
  poll engine covers only the reconnect gap. `OutboundGuard` (hard per-minute
  ceilings, manual reset) + the rate-limit governor reading live
  `X-Rate-Limit-*` headers are the load-bearing safety layer.
- **Search phase model** (plans 43+44) — intent (search/room/global `enabled`) is
  user-only; **phase** is system-only with one derivation point
  (`publishEngineStatus`). Sticky-degraded family → flap detector, 5-min
  stability window, 5/10/30-min recovery ladder, terminal **`halted`** phase.
  Rooms are a layered gate (D-room-1 v2) that never overwrites a member's own
  `enabled`.
- **Deal watch** (plan 41) — price-fixer-resistant baseline, self-created
  content-addressed GGG search with a value-converted price cap, auto-swapping
  the row's id once it drifts by more than 5%. Rates come from GGG **currency
  exchange** (D-dw-21) since poe2scout's API 404s.
- **Operator UX** — rooms, live-hits panel, archive/restore, first-run
  onboarding, price check, activity timeline, Travel/Buy from the Hits view.
- **Buy automation** (D-18/D-19/D-20) — Electron-only, independent of
  auto-travel, ends at a human-like mouse MOVE (**no click**), gated on the
  macOS permission capability.
- **Session at rest** — AES-256-GCM. The key comes from the platform's
  `SecretKeyStore` port: Electron `safeStorage` in the packaged app (OS-backed on
  macOS/Windows/Linux), the macOS `security` CLI for the standalone server. No
  OS store → plaintext + a loud warning (a keyring-less box still works). An
  undecryptable session degrades to "signed out", never a throw.
- **Distribution scaffolding** — public bilingual `README.md` / `README.pl.md`;
  `.github/workflows/release.yml` builds mac dmg + win nsis + linux AppImage on a
  `v*` tag (draft release); `GET /api/update` checks GitHub Releases and shows a
  banner (**check-only** — silent auto-update needs signing).

### Not yet proven

- **On-Mac hardware validation** of the natives — capture-stream non-black (O-6),
  uiohook-for-synthetic (O-7), HiDPI mapping (O-8), the raw-pixel CV thresholds
  (`TODO(verify)`), and the price-check desktop layer (synthetic Cmd+C under
  Wine + click-through overlay). All still unvalidated.
- **Live proof** — first hit/travel end-to-end, first DEAL alert, deal-watch
  Phase 3 with the operator, P0.2b multi-day id-aging.
- **CI is Ubuntu-only** — the macOS/Windows native paths are never exercised on
  their target OS.

### Blocking a public release

- ~~No LICENSE~~ — **done** (D-23): proprietary freeware EULA, source-available.
  The repo stays public for auditability; the licence, not secrecy, prevents
  copying. `THIRD-PARTY-NOTICES.md` is generated and ships in `extraResources`.
- **No code signing / notarization** — `"identity": null`. D-18 recorded a real
  Developer ID as a **hard release prerequisite**: without a stable Team ID the
  macOS TCC grants (Screen Recording + Accessibility) reset on every update.
- **No crash/error reporting** and only partial support links (repo + bug report
  are wired; social/donation still empty) — failures on other machines are
  invisible.
- **ToS exposure of Buy automation** — synthetic input into a live game is the
  most exposed surface and the least validated; shipping it to strangers is a
  decision, not a default.

Review records live in `docs/process/reviews/`. Extra hard rule learned in Phase
1 (see `docs/process/conventions.md`): every NestJS constructor param needs an
explicit `@Inject(...)` — tsx emits no decorator metadata.
