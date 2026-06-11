# CLAUDE.md — poe-trade-sniper session manifest

Read this first, every session.

## Hard rules

1. **The old prototype `~/Projects/poe2-live-sniper` is OFF-LIMITS** —
   read-only reference. Bartosz uses it daily; it runs on :3411. Cutover
   happens at Phase 5, not before.
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
  questions): `~/Vault/Projects/Poe-Trade-Sniper/`

## State of the build

Phases 1–2 shipped — headless detection (`/api/searches`, `/api/events` SSE)
plus browser-free travel (`TravelService` queue, auto-travel opt-in, manual
`POST /api/travel`); session via `pnpm session:import` or cookie paste. See
the Vault master plan §11. Web UI (Phase 3), session capture/in-app login
(Phase 4), Electron (Phase 5) pending. NOT yet validated against live GGG.

Extra hard rule learned in Phase 1: see `docs/process/conventions.md` — every
NestJS constructor param needs an explicit `@Inject(...)` (tsx emits no
decorator metadata).
