# Plan 45 — Travel/Buy actions in the Hits view (≤60 min)

**Ask (operator):** the Hits view (`HitsPage`) should also carry Travel + Buy
buttons for hits **not older than 60 minutes** since detection — the same
actions the live Hits panel offers, so a recently-missed hit can still be
actioned from the browsable history.

## Constraints discovered

- The persisted `Hit` **never carries a hideout token** — it is stripped at read
  time (`search-manager.ts` "expired by read time (~300 s TTL) — never persisted").
  So **every** Hits-view action must go through the server **re-resolve** path,
  never the direct token path.
- `POST /api/travel/retry` already re-resolves a fresh token by
  `{searchId, listingId, offerKey}` and travels — works for any aged hit; a gone
  offer degrades to a `failed` travel event with `item_gone` ("no longer listed").
- **There was no Buy equivalent** — `/api/buy` needs a live token, and `HitCard`
  disables Buy when the token is stale. Aged Buy had no server path.
- `offerKey(hit)` is computable client-side (item/seller/price/signature — all on
  a persisted `Hit`), so the client can drive the re-resolve.

## Server

- **`POST /api/buy/retry`** (new, `BuyController`): body `{searchId, listingId,
offerKey}`. Re-checks `canControl` (UI gating is not authoritative), marks
  `buyAutomation.requestManualBuy(listingId)`, then `travelService.retryTravel(...)`.
  Mirrors the existing `buy()` (mark → travel) but re-resolves instead of using a
  token. No new DI edge (BuyAutomationService does not import TravelService, so no
  cycle; the controller already injects both). The buy-on-arrival intent keys on
  the ORIGINAL `listingId`, which `retryTravel` re-tags its travel events with, so
  travel-success matches and the buy fires. A gone offer never travels → the
  one-shot intent lingers harmlessly in the bounded `forceBuyListingIds` set.

## Frontend

- **`useHitActions()` hook** (new): the travel / buy / travelRetry / buyRetry /
  locateSearch API wiring, taking a `Listing`. Removes the inline duplication from
  `HitsPanel` and gives `HitsPage` the identical wiring (one source of truth).
- **`<HitActions>` component** (new): the travel/buy phase display + Travel / Buy /
  Retry button cluster, extracted from `HitCard` (the tricky, divergence-prone
  part). Props: `travelState`, `buyState`, `tokenFresh`, `canBuy`, `onTravel`,
  `onBuy`, `onTravelRetry`, `onBuyRetry`. Travel click → `tokenFresh ? onTravel :
onTravelRetry`; Buy click → `tokenFresh ? onBuy : onBuyRetry`.
- **`HitCard`** refactors onto `<HitActions>` — the live panel now also re-resolves
  an aged Buy (a consistency win; previously Buy just greyed out).
- **`HitsPage`**: for hits with `now − detectedAt ≤ 60 min`, render `<HitActions
tokenFresh={false}>` (persisted hits are always aged → always re-resolve) wired
  via `useHitActions`. The row is restructured so the action cluster is a SIBLING
  of the expand `<button>` (no nested buttons). A coarse clock tick ages the
  window out while viewing; `canBuy` from `useServerStatus`.
- i18n: reuses the existing `hitCard.*` keys.

**Tunable:** `HIT_ACTION_MAX_AGE_MS = 60 * 60_000` (Hits-view action window).

## Review outcome (2026-07-11)

Full multi-specialist review + adversarial verification: **PASS** (record
`docs/process/reviews/2026-07-11-hits-view-actions.md`). Fixes applied pre-commit:

- **CORR-1** — buy/retry evicts the manual-buy intent (`clearManualBuy`) when the
  re-resolve won't travel, so a later Travel-only can't inherit it.
- **REL-1** — `retryTravel` now budget-guards the manual re-resolve (mirrors the
  auto path's `minHeadroom` reserve); refusals ride the travel-event channel.
- **SRV-500** — the tier-2 re-search throw is caught in `retryTravel` → a `failed`
  travel event (reason `server_error`), never a bare 500 with budget spent.
- **FEEDBACK** — `useHitActions` logs rejections (403 gate / network) instead of a
  silent no-op.
- **STATUS-DROP** — `HitBuyStatus` in the Hits view is no longer gated on the age
  window (an in-flight buy keeps its status past 60 min).
- **ARCH-VALIDATION** (`parseOrBadRequest`), **ICON-A11Y** (`aria-hidden`),
  **CON-ORPHAN** (dead `hitCard.tokenExpired` removed), tests **TEST-1/2/3**
  (`retryPayload`, `retryTravel` re-tag/gone/no-budget/error, buy/retry evict).

Note: `<HitActions>` renders only the button cluster + travel-phase status; the
buy-automation status line was split into a sibling `<HitBuyStatus>` so each
caller places it in its own layout. Tracked S4 (non-blocking) items are listed in
the review record.

## Out of scope / parked

- Persisting a `securable` flag on hits (to hide actions on non-instant-buyout
  hits up front instead of degrading to "no longer listed" on click). The
  re-resolve path already degrades gracefully and most 60-min-old listings are
  gone anyway, so this is a future refinement, not needed for the feature.
