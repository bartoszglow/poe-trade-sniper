# Running locally

## Prerequisites

- Node 22 (`nvm use` reads `.nvmrc`), pnpm 11 (`corepack enable` or global).
- gitleaks (`brew install gitleaks`) — pre-push refuses to run without it.

## Setup

```bash
pnpm install
cp .env.example .env       # defaults are fine for dev
```

## Develop

```bash
pnpm dev                   # server (:3500) + web (:5180) in parallel
pnpm --filter @poe-sniper/server dev   # server only
pnpm --filter @poe-sniper/web dev      # web only (proxies /api → :3500)
```

- Server API: `http://localhost:3500/api/health`
- Web UI: `http://localhost:5180`

## Verify & build

```bash
pnpm verify                # lint + typecheck + test — the merge gate
pnpm build                 # all workspaces
pnpm db:migrate            # apply migrations without booting the server
```

The SQLite file lives at `DB_PATH` (default `apps/server/data/dev.db`,
gitignored). Delete it to start fresh — startup migrations rebuild it.

## Operate the sniper headless (Phase 1)

```bash
# 1. Session — either import the prototype export…
pnpm --filter @poe-sniper/server session:import   # [path] optional
#    …or paste cookies from your browser devtools:
curl -X POST localhost:3500/api/session/cookies -H 'Content-Type: application/json' \
  -d '{"cookies":{"POESESSID":"…","cf_clearance":"…"},"userAgent":"<your browser UA>"}'

# 2. Watch a search (bare id or any trade2 URL)
curl -X POST localhost:3500/api/searches -H 'Content-Type: application/json' \
  -d '{"input":"AbCdEf123","label":"ES boots","purchaseMode":"instant","autoTravel":false}'

# 3. Observe
curl localhost:3500/api/status            # session probe, rate-limit budget, engines
curl localhost:3500/api/searches          # per-search engine + status
curl localhost:3500/api/hits              # persisted detections
curl -N localhost:3500/api/events         # live SSE stream
```
