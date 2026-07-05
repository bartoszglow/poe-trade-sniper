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

Phases 1–4 shipped + preliminary Electron shell: detection (SSE, ws/poll with
demotion + safety guard), browser-free travel, full operator UI, dual-path
auth (in-app Chrome login + cookie paste), session encrypted at rest.
Live-validated 2026-06-12: session probe, ws connect (GGG live is back; 1013
backoff handled), league endpoint. Remaining: first-hit/travel live proof,
full Phase 5 packaging. Self-review: `docs/process/reviews/2026-06-12-self-review.md`.

macOS desktop-automation track (2026-06-24): **Phase 1** permission framework
(Screen Recording + Accessibility, Option A, capability gate) and **Phase 2**
per-search Buy automation (focus → capture → detect → human-like move, **NO
click**; Electron-only; independent of auto-travel, D-19) shipped + reviewed (52
findings → fix plan `docs/planning/25`, fixes applied D-20). Native input/capture
(`nut.js`/`uiohook`/`desktopCapturer` + raw-pixel CV) still needs on-Mac hardware
validation: capture-stream non-black, CV thresholds, uiohook-for-synthetic.

Extra hard rule learned in Phase 1: see `docs/process/conventions.md` — every
NestJS constructor param needs an explicit `@Inject(...)` (tsx emits no
decorator metadata).

Deal-watch (2026-07-05, plan 41): **#41 deal mode** shipped end-to-end — flip a
search into deal mode; the server maintains a price-fixer-resistant baseline
(median of cheapest usable listings, exalted-normalized via poe2scout rates),
derives a price-capped GGG search (self-created content-addressed id, no-option
value-converted cap — evidence in `api-notes.md` §"Self-created searches"),
auto-swaps the row's id on >5% drift, and emits `deal` events with discount
context; full operator UI (row chip, modal with baseline+trend sparkline, deal
feed kind, distinct alerts). Phase 0 live-probed; both phases shipped after
adversarial reviews with all confirmed findings fixed pre-commit. Remaining:
multi-day id-aging evidence (P0.2b tail), Phase 3 live validation with the
operator, Activity re-derive feed entry (parked).

Operator-UX + tooling session (2026-07-02→03): shipped **#33 rooms** (named
groups, DnD, master switch, auto-expand), **#34 live-hits panel** (resize/hide +
click-to-locate spotlight), **#35 search archive/restore**, **#36 first-run
onboarding** (wizard + checklist), **#37 price check** (clipboard→trade2/poe2scout,
budget-gated, versioned dictionary, in-app panel + Price Checks nav view + desktop
hotkey/overlay), plus login/logout UX, universal ConfirmDialog. Plans in
`docs/planning/33–37`. **Still needs on-Mac hardware validation:** the price-check
desktop layer (synthetic Cmd+C under Wine + click-through overlay) — same gap as
the Buy-automation natives. Full pending list + parked items:
memory `session-2026-07-state-and-pending`.
