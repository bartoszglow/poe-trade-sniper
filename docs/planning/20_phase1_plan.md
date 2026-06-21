---
type: project
status: done
tags: [poe2, sniper, phase1, detection]
created: 2026-06-12
updated: 2026-06-12
---

# Phase 1 — Detection core (detailed plan)

> **SHIPPED 2026-06-12** — commits `765a31d → dbac6cd` (10 commits, local).
> 66 unit + 7 e2e green. Additions vs plan: per-search **purchase mode**
> (D-10 auth strategy, securable-only verified — O-5 capture pending),
> cookie-paste auth path, D-11 explicit-@Inject rule (tsx metadata gotcha).
> NOT validated against live GGG yet — session import + first live run is the
> next session's first task.

Goal: headless detection at parity with the prototype — watched searches
persisted in SQLite, ws/poll engines behind a registry, shared rate-limit
budget, hits persisted + streamed over SSE. **CLI/API only** (operate via
curl); UI lands in Phase 3. Travel is Phase 2.

> **DoD:** with an imported session, `POST /api/searches {input: <id|url>}`
> starts detection; new listings appear in the `hits` table and on
> `GET /api/events` (SSE) within seconds (poll mode; ws when GGG live is back).
> `pnpm verify` + e2e green without touching live GGG.

## Commit order

1. **shared + items/** — reconcile `ItemDetail`/`Listing` types with the real
   normalized shape (prototype-accurate: `label/value` properties, nullable
   rarity/baseType, `raw` passthrough); port `cleanMarkup` +
   `normalizeItemDetail` + `normalizeListing` as pure functions with tests.
2. **config** — Phase 1 tunables in the Zod schema (+ `.env.example`):
   `POE_BASE_URL`, `DEFAULT_LEAGUE`, `POLL_INTERVAL_MS` (floor 6000),
   `FETCH_SPACING_MS` 600, `FETCH_BATCH_SIZE` 10, `MAX_FRESH_IDS_PER_TICK` 20,
   `SEEN_IDS_CAP` 5000, `WS_HANDSHAKE_TIMEOUT_MS` 10000 (tarpit guard),
   `WS_RECONNECT_BASE_MS` 5000 / `WS_RECONNECT_MAX_MS` 120000,
   `WS_KEEPALIVE_PING_MS` 30000, `OUTBOUND_TIMEOUT_MS` 15000.
3. **events/** — typed `RealtimeBus` over the `DomainEvent` union +
   `GET /api/events` SSE controller (heartbeat, cleanup on disconnect).
4. **session/** — `SessionStore` interface + DB-backed impl (`app_state`,
   key `session`); `SessionService` (cookie header build, UA, public status);
   `pnpm session:import [path]` CLI importing the prototype's
   `session-state.json` (filters cookies to `pathofexile.com` domain,
   `HeadlessChrome`→`Chrome` UA fix); `GET /api/session/status` (public shape
   only — never the cookies).
5. **ratelimit/** — shared governor: parses live `X-Rate-Limit-*` headers per
   policy, spaces requests, 429 ⇒ global pause for `Retry-After`. Unit tests
   for header parsing + budget math.
6. **trade-api/** — `TradeApiClient` (resolve / execute / fetchListings /
   probeMyAccount): the only module talking to GGG; header discipline,
   correlation ids, AbortController timeouts, governor on every call.
   Tests with injected fetch (recorded-shape fixtures).
7. **engines/** — `DetectionEngine` interface + registry `[ws, poll]`;
   `WsEngine` (cookie'd handshake, timeout, exp backoff, keepalive ping,
   `{new: ids[]}` messages), `PollEngine` (newest-first id diff, bounded seen
   set, fresh-cap). Selection: ws probe → poll fallback → periodic upgrade.
8. **search/ + api/** — `SearchManager` (DB-backed CRUD, engine lifecycle,
   hit persistence to `hits`, events), shared round-robin poll scheduler (one
   search POST per tick across all polled searches); controllers:
   `GET/POST/DELETE /api/searches`, `PATCH /api/searches/:id`,
   `GET /api/status`. Zod at the edge.
9. **e2e + docs** — e2e for the API surface (no live GGG), CHANGELOG,
   `docs/architecture/engines.md`, api-notes additions (ws `{new}` payload).

## Decisions inside this phase

- Local price filters from the prototype are NOT ported — the trade query
  itself filters; redundant layer dropped.
- Sound notification deferred to Phase 3 (UI alerts); hits are persisted +
  streamed meanwhile.
- Engines refuse to start without an imported session → `engine-status:
degraded` + log event (no anonymous tarpit connections).
- Fixture capture: prototype is down, so fixtures get recorded through the new
  adapter once the imported session validates (replaces the original
  "capture while prototype lives" task).

## Carry-over guards (api-notes)

Rate limits are dynamic per-IP with stacking lockouts; search/fetch/whisper
have separate policies; ws handshake without cookies tarpits — timeout is
mandatory; broad searches can turn over 100+ ids per poll — cap fresh ids.
