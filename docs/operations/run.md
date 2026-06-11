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
