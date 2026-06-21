---
type: project
status: active
tags: [poe2, sniper, phase0, foundation]
created: 2026-06-12
updated: 2026-06-12
---

# Phase 0 — Foundation (detailed plan)

Goal: a green, empty-but-disciplined skeleton in `~/Projects/poe-trade-sniper`.
No domain logic yet — every convention, gate, and seam in place so Phases 1–5
only _add_ code. Mirrors card-bridge's Phase 0 shape.

> **Definition of done:** fresh clone → `pnpm install && pnpm verify` green →
> `pnpm dev` boots the NestJS server (health endpoint OK, migration applied)
> and the React shell renders with the nav registry. CI green on GitHub.

---

## 0.1 Repo bootstrap

1. `git init` in `~/Projects/poe-trade-sniper` (private GitHub repo `poe-trade-sniper`).
2. pnpm workspace: `pnpm-workspace.yaml` with `apps/*`, `packages/*`.
3. Node 22 pinned: `.nvmrc` + `"packageManager": "pnpm@<current>"` + `engines`.
4. Root `package.json` scripts (workspace-wide):
   - `dev` (server + web concurrently), `build`, `lint`, `typecheck`, `test`,
     `verify` = lint + typecheck + test, `db:migrate`, `format:check`.
   - **Reserved-name rule:** no script named `login`/`install`/etc. (pnpm
     builtins shadow them — prototype gotcha §10.9).
5. `.gitignore`: `node_modules`, `dist`, `.env*`, `*.db`, `session.json`,
   `coverage`, `.DS_Store`.
6. `README.md` — one-paragraph purpose + quickstart + pointer to `docs/`.

## 0.2 Tooling & quality gates

1. `tsconfig.base.json` — strict, `noUncheckedIndexedAccess`,
   `noImplicitOverride`, `exactOptionalPropertyTypes` (drop only if NestJS DX
   suffers), path alias `@poe-sniper/shared`.
2. **ESLint 9 flat config** (root `eslint.config.mjs`): typescript-eslint
   strict, `no-eval`, no unsafe `child_process`, import ordering. React rules
   scoped to `apps/web`.
3. **Prettier** `.prettierrc.json`: single quotes, semicolons, 100 cols,
   trailing commas.
4. **Husky + lint-staged**: pre-commit = lint-staged (eslint --fix + prettier);
   pre-push = `format:check` + `pnpm audit --audit-level=high` + gitleaks.
5. **Vitest** root config + per-app projects; **Playwright** installed, one
   placeholder e2e spec hitting `/health` (real e2e starts Phase 1).
6. `CHANGELOG.md` — Keep a Changelog, `[Unreleased]` seeded.

## 0.3 `packages/shared`

Canonical domain types only — no logic, no IO:

- `ManagedSearch` (id, realm, league, label, autoTravel, filters, addedAt),
- `Listing` / `Hit` (listingId, itemName, price, seller, at),
- `ItemDetail` (rarity, base, ilvl, corrupted, properties, requirements, mod groups),
- `DomainEvent` union for the RealtimeBus (`hit`, `searches-changed`, `log`,
  `engine-status`) — closed union from day one,
- `SessionState` shape (cookie set + UA + capturedAt) — type only; storage in server.

Built with `tsc`; consumed via workspace protocol by server + web.

## 0.4 `apps/server` (NestJS)

1. NestJS app booting on a configurable port. Modules created **empty but
   wired**: `ConfigModule`, `DbModule`, `ApiModule`. (Domain modules —
   session/trade-api/engines/search/travel/ratelimit/events/items — arrive in
   Phases 1–2; folders not pre-created to avoid dead scaffolding.)
2. **config/**: Zod env schema (`PORT`, `APP_ENV`, `DB_PATH`, plus tunables
   placeholder section) — parse at boot, **process exits with a readable error
   on bad config**. `.env.example` committed.
3. **db/**: Drizzle + **better-sqlite3** (D-6). Schema v1: `searches`, `hits`,
   `app_state` exactly as master plan §5. Forward-only migrations in
   `db/migrations`, **applied automatically on startup**; `db:migrate` script
   for manual runs. DB file path from config (defaults to `./data/dev.db`,
   gitignored).
4. **api/**: `GET /health` → `{ status, version, dbMigrated }`. Inbound
   validation pattern established (Zod at the edge) even though health takes
   no input.
5. Logging: Nest logger with a **correlation-id pattern stubbed** (middleware
   assigns an id per request; engines will reuse the pattern in Phase 1).
6. Unit tests: config schema (bad env fails), migration runner (fresh DB gets
   all tables), health controller.

## 0.5 `apps/web` (React + Vite + Tailwind)

1. Vite + React + Tailwind (dark class strategy + persisted toggle).
2. **App shell + nav registry** (`shell/nav.ts`): the open/closed seam — pages
   register here; shell never changes. Seed entries: Searches, Hits, Settings
   (each a placeholder page).
3. First atomic components only as actually needed by the shell (`Badge`,
   `Button`) — the _rule_ (extract on 2nd use, enum variants, no booleans) goes
   in `docs/architecture/frontend.md`; we do not pre-build a component zoo.
4. `lib/api.ts` — typed fetch wrapper against the server; reads base URL from
   env so the same build works in web and (later) desktop mode.
5. Health indicator in the shell footer calling `/health` — proves the
   server↔web wiring end-to-end.

## 0.6 `docs/` system (seeded, card-bridge shape)

```
docs/
├── README.md                  index by purpose (mirror card-bridge docs/README)
├── architecture/architecture.md   repo layout, engine-registry contract (stub), topology
├── architecture/frontend.md       shell/nav registry, atomic-component rule, SSE pattern
├── integration/api-notes.md       GGG API evidence log — seeded NOW with §10 knowledge
├── process/conventions.md         quality gates, git rules, testing, no-guessing rule
└── operations/run.md              dev quickstart (install, env, dev, verify)
```

`integration/api-notes.md` is seeded in Phase 0 with the master-plan §10 facts
(each with date + evidence pointer) so the knowledge survives even before
Phase 1 code exists. `engines.md`, `travel.md`, `desktop.md`, `packaging.md`
are created in their respective phases — no empty placeholder docs.

## 0.7 Repo `CLAUDE.md`

Session manifest, card-bridge style — hard rules up top:

- old prototype `~/Projects/poe2-live-sniper` is **off-limits** (read-only reference),
- no-guessing rule → `docs/integration/api-notes.md`,
- session/cookies are secrets: never logged, never sent to UI,
- rate-limit governor is load-bearing — never bypass `trade-api`,
- all code/comments/commits in English; no `Co-Authored-By`,
- `pnpm verify` before commit; explicit-path `git add`,
- pointers: master plan + decisions live in `Vault/Projects/Poe-Trade-Sniper/`.

## 0.8 CI (GitHub Actions)

`.github/workflows/ci.yml`: pnpm cache → install → `verify` → build all apps →
`pnpm audit` → gitleaks action. Single job is fine at this size; split later if
slow. Branch protection on `main` once green.

---

## Execution order & commits

Each step = one logical commit (explicit paths, English message):

1. repo bootstrap + workspace + pins (0.1)
2. tsconfig/eslint/prettier (0.2.1–3)
3. husky + lint-staged + changelog (0.2.4, 0.2.6)
4. `packages/shared` types (0.3)
5. server boot + Zod config (0.4.1–2)
6. drizzle + schema v1 + migrations + tests (0.4.3, 0.4.6)
7. health endpoint + correlation-id middleware (0.4.4–5)
8. web shell + nav registry + health indicator (0.5)
9. docs system + repo CLAUDE.md (0.6, 0.7)
10. CI workflow + placeholder e2e (0.8, 0.2.5)

## Acceptance checklist

- [ ] `pnpm install && pnpm verify` green on a fresh clone
- [ ] `pnpm dev` → server boots, migration applies, `/health` returns OK
- [ ] web shell renders, nav registry drives pages, health dot green
- [ ] bad `.env` → server refuses to start with a readable error
- [ ] pre-commit + pre-push hooks fire; gitleaks clean
- [ ] CI green on GitHub; CHANGELOG has Phase 0 entry
- [ ] `docs/integration/api-notes.md` contains all §10 facts with dates

## Explicitly out of scope (Phase 0)

No GGG API calls, no engines, no session capture (not even the import — that is
Phase 1), no SSE, no Electron, no real e2e fixtures. Foundation only.
