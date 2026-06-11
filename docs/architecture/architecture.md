# Architecture

## Topology — one server, two shells

The NestJS server (`apps/server`) is the entire product: detection engines,
trade-API adapter, rate-limit governor, persistence, realtime events. UIs are
thin shells over its HTTP + SSE surface:

- **Web mode** (dev + browser): server runs standalone; the React app
  (`apps/web`) talks to it over relative `/api/*` URLs (Vite proxy in dev).
- **Desktop mode** (Phase 5): Electron boots the same server in its main
  process and loads the same React build — same-origin, no client changes.

The server is shell-agnostic by construction: no browser assumptions, session
capture behind a `SessionSource` interface, every GGG call inside `trade-api`.

## Repo layout

```
apps/server     NestJS core — the only process with business logic
apps/web        React operator UI (shell over the API)
packages/shared canonical domain types (no logic, no IO)
e2e             Playwright against the server API
docs            this documentation
```

## Layering rules (server)

- `api/` controllers are thin: validate at the edge (Zod), call a service.
- `trade-api/` is the ONLY module that talks to pathofexile.com. The header
  discipline (X-Requested-With, Referer, cookies) lives here once.
- Every outbound GGG call goes through the `ratelimit/` governor and carries a
  correlation id; every call has an AbortController deadline.
- `db/` owns Drizzle schema + forward-only migrations, applied on startup.
- Config comes exclusively from the Zod-validated env schema
  (`config/env.ts`) — no magic numbers in code; tunables are config.

## The engine-registry contract (open/closed core)

Detection strategies implement `DetectionEngine` and are registered in an
array — `[WsEngine, PollEngine]`. Adding a strategy = appending to the list;
the SearchManager never changes. Engine selection per search: boot probe
(ws → fallback poll), automatic upgrade when GGG live returns.

## Cross-cutting invariants

- **Correlation id** threads every detection → fetch → travel leg.
- **Bounded growth**: seen-id sets are capped and evicted; hit history pruned.
- **Cleanup**: every socket, timer and SSE subscription tears down on
  stop/disconnect.
- **Secrets**: the PoE session is a credential — never logged, never exposed
  through the API, persisted only via the SessionStore.
