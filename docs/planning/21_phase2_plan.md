---
type: project
status: done
tags: [poe2, sniper, phase2, travel]
created: 2026-06-12
updated: 2026-06-12
---

# Phase 2 — Travel (detailed plan)

> **SHIPPED 2026-06-12** — commits `0339ac9 → b6ca095` (4 commits, local).
> 74 unit + 8 e2e green. Per Bartosz mid-phase: Settings UI (Phase 3) MUST
> offer BOTH in-app login AND cookie paste — neither is a fallback (recorded
> in repo `docs/architecture/auth.md`). Live validation still pending.

Goal: browser-free hideout travel at prototype parity, productionized —
queued, rate-limit-governed, evented. Travel teleports the real character, so
every guard rail from D-5 applies.

> **DoD:** a securable hit on an auto-travel search triggers exactly one
> queued `POST /api/trade2/whisper` with the header discipline; manual travel
> works via `POST /api/travel`; every phase (queued/started/success/failed)
> streams on SSE. Tests green; no live GGG in tests/e2e.

## Commit order

1. **shared + config** — `TravelEvent` joins the `DomainEvent` union
   (`queued | started | success | failed`, source `manual | auto`); tunables:
   `TRAVEL_MIN_SPACING_MS` (default 2000), `TRAVEL_TOKEN_MAX_AGE_MS`
   (default 240 000 — hideout tokens die at ~300 s; stale queue entries are
   dropped, not fired).
2. **trade-api `travel()`** — `POST /api/trade2/whisper {token}` under the
   separate `whisper` rate-limit policy, with the decisive
   `X-Requested-With: XMLHttpRequest` + `Referer` = the search page URL
   (without them: 403 code 6). Parses `{success:true}` / error JSON. Tests
   assert the exact header discipline with injected fetch.
3. **travel/ module** — `TravelService`: FIFO queue processed strictly
   one-at-a-time (a travel teleports the character); stale-token drop;
   subscribes to `hit` events on the RealtimeBus and auto-enqueues when the
   search has `autoTravel` AND the listing carries a hideout token (decoupled
   from SearchManager via pub/sub; only reads the autoTravel flag through a
   narrow SearchManager helper). `POST /api/travel` for manual travel (Zod);
   travel section in `GET /api/status`. Unit tests: serialization, stale
   drop, auto-trigger conditions, failure events.
4. **e2e + docs** — e2e validation paths (no live GGG),
   `docs/architecture/travel.md`, CHANGELOG, Vault updates.

## Deliberate scope cuts

- **Browser fallback (Playwright/Electron window click)** — deferred until
  the API path ever rejects in practice (master plan allows lazy fallback);
  a failed travel surfaces as a `failed` event instead.
- No travel retries: the token is single-context and the listing is likely
  gone ("In demand") — operator sees the failure on the stream.

## Guard rails (D-5 recap)

Auto-travel: per-search explicit opt-in, validated securable at add/update
time, one queue for the whole app, never default-on.
