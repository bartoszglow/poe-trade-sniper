# 30 — Travel-retry via re-resolve (fresh token)

**Status: IMPLEMENTED** (2026-07-01). verify green (server 182, web 13, desktop 6).

## Problem

A retry of travel/buy on an aged live hit fired the **stored** hideout token, which is
dead by then (~300 s TTL, never persisted — hard rule #3), and GGG re-serves offers under
fresh **ephemeral** result-hash ids, so the old id may not even resolve. The UI also
disabled the Retry button past 240 s ("expired"). Net: retry on an aged hit was structurally
impossible.

## Fix — re-resolve before travelling

The retry obtains a FRESH token instead of reusing the old one:

- **Tier 1 (cheap, FETCH bucket):** re-`fetch` the known id; if it still resolves to the
  same offer (matched by `offerKey`) with a token, travel with that.
- **Tier 2 (fallback, manual, single-shot):** re-run the search's stored query newest-first,
  fetch the top batch, match by `offerKey`, travel with the fresh token. No match ⇒ the
  offer is gone → surface "no longer listed" (don't fire a doomed teleport).

Tier 2 spends a SEARCH-bucket hit (30-min lockouts stack), so it's **manual + single-shot**
only — auto-travel stays fire-once on fresh hits and never re-searches.

## Shape

- `SearchManager.refreshListing(searchId, listingId, offerKey) → Listing | null` (tier 1→2).
- `TravelService.retryTravel(...)` — travels with the fresh token but tags the event with
  the ORIGINAL listingId so the live-hits card tracks it; emits `failed` ("no longer listed")
  when gone.
- `POST /api/travel/retry { searchId, listingId, offerKey }` — no token in the body.
- Web: the failed/expired Retry button (and a stale Travel button) re-resolve instead of
  firing the dead token; "Refreshing…" state; EN/PL i18n.

## Evidence / discovered behaviour (hard rule #2)

Recorded in `docs/integration/api-notes.md`: the hideout token comes from the FETCH payload
(securable listings only); result ids are ephemeral (per `offer.ts`); whether a recently-issued
id stays fetchable long enough for a cheap Tier-1 refresh is **TODO(verify)** (needs a
recorded/mock probe — never live, hard rule #8). Tier 2 is the reliable path.

## Tests

`SearchManager.refreshListing`: tier-1 fetch-by-id match, tier-2 re-search match, and
"gone → null". (Mocked trade-api; never live — hard rule #8.)
