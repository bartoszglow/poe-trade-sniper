---
type: project
status: done
tags: [poe2, sniper, phase3, web-ui]
created: 2026-06-12
updated: 2026-06-12
---

# Phase 3 — Web UI (detailed plan)

> **SHIPPED 2026-06-12** — commits `800e80e → 3507b9b` (5 commits, local).
> 74 unit + 9 e2e green, full build green. Addition vs plan: new server
> endpoint `POST /api/session/probe` (Settings "Verify session" + post-paste
> auto-probe). Visual pass in the browser deferred to the live-validation
> session (per chrome-on-explicit-request rule).

Goal: operator UI at prototype parity on the Phase 0 shell (D-8 layout).
Operator = admin view → exempt from mockup-first (shell itself was approved
via mockups). Desktop-first per D-8; degrades below lg (hits panel collapses,
pages stay usable).

> **DoD:** add/manage searches from the UI; live hits stream into the right
> panel with a working Travel button; full history with item-detail
> accordion; Settings offers cookie paste (working) + in-app login (visible,
> disabled until Phase 4/5 — D-12). `pnpm verify` + e2e green.

## Commit order

1. **Realtime plumbing** — `apiSend` (POST/PATCH/DELETE with server-message
   errors); `EventStreamProvider` (one `EventSource` on `/api/events`):
   connected flag, live hits (capped), engine statuses, travel states,
   searches version; `useServerStatus` (10 s poll of `/api/status`); shell
   wiring — AppBar live dot = SSE state, StatusBar session dot + search
   budget from governor snapshots.
2. **Atoms** — `Field`, `TextInput`, `Select`, `Switch`, `IconButton`
   (variants as enums); semantic `RarityName` (rarity → color token),
   `PriceTag`.
3. **Searches page** — list with engine/status badges + hit counts (live via
   events); add form (id/URL, label, league, purchase mode, AUTO opt-in with
   warning); inline AUTO toggle + purchase-mode select (PATCH); two-step
   delete. Purchase-mode labels mirror the trade-site dropdown.
4. **Hits** — live panel cards (time, rarity-colored name, price, seller,
   Travel button gated on token presence + age < 240 s) with per-listing
   travel state from SSE; Hits page = persisted history, filter by search,
   expandable accordion rendering normalized ItemDetail (properties,
   requirements, mod groups).
5. **Settings + wrap-up** — session card (probe state, cookie names);
   cookie-paste form; in-app login button disabled with "Phase 4" badge
   (D-12: both paths committed, paste ships first); clear-session (two-step);
   rate-limit snapshot card. Docs (frontend.md update), CHANGELOG, Vault.

## Scope cuts

- No sound alerts (future_ideas), no analytics page (Phase 6+), no toasts
  framework — travel feedback renders inline on the hit card.
- League picker stays a free-text field until O-5 captures the league-list
  endpoint.
