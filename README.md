# poe-trade-sniper

Personal Path of Exile 2 trade sniper: watches trade searches, detects new
listings within seconds (WebSocket push with polling fallback), and travels to
the seller's hideout browser-free via the securable-listing token flow. One
NestJS core, two shells: local web UI and (later) an Electron desktop app.

## Quickstart

```bash
nvm use            # Node 22
pnpm install
cp .env.example .env
pnpm dev           # server + web
pnpm verify        # lint + typecheck + test
```

## Where things live

- `apps/server` — NestJS sniper core (engines, trade API adapter, rate-limit governor)
- `apps/web` — React operator UI
- `packages/shared` — canonical domain types
- `docs/` — how this project is built; start with [docs/README.md](docs/README.md)

The GGG trade API is undocumented — see `docs/integration/api-notes.md` before
touching anything that talks to pathofexile.com.
