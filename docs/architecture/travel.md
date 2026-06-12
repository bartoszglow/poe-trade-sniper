# Travel

## The browser-free path

`TradeApiClient.travel()` POSTs the listing's `hideout_token` to
`/api/trade2/whisper` with the decisive header pair (api-notes):

- `X-Requested-With: XMLHttpRequest` — without it: **403 code 6**, even with a
  valid session;
- `Referer` = the search's trade page URL.

This also bypasses the trade site's client-side "In demand. Teleport Anyway?"
modal. Whisper has its own rate-limit policy (`whisper`), spaced by
`TRAVEL_MIN_SPACING_MS` through the shared governor.

## The queue (TravelService)

Strictly FIFO, **one travel at a time** — every travel teleports the real
character; concurrent travels would bounce it around. Entries older than
`TRAVEL_TOKEN_MAX_AGE_MS` (default 240 s; tokens die at ~300 s) are dropped
with a `failed` event, never fired.

Lifecycle streams on SSE as `travel` events:
`queued → started → success | failed` (source `manual` or `auto`).

## Auto-travel

Event-driven, decoupled from detection: the service subscribes to `hit`
events on the RealtimeBus and enqueues only when **both** hold:

1. the search has `autoTravel` enabled (explicit opt-in, validated securable
   at add/update time — D-5), and
2. the listing carries a `hideout_token`.

### One travel per listing

A listing re-enters the live stream as a brand-new hit when the buyer
travels, does not purchase, and returns to hideout (trade-site behavior).
`TravelService` therefore remembers successfully-traveled listing ids
(insertion-ordered set, bounded by `TRAVEL_DEDUPE_MAX_ENTRIES`, default 500)
and skips **auto**-travel for them. Manual travel is always allowed, and a
failed travel is not remembered — the next re-detection may retry. The memory
is in-process only: after a server restart one extra auto-travel to a
re-detected listing is possible (accepted — same lifetime as the queue).

## Manual travel

`POST /api/travel {token, realm, league, searchId, listingId?, itemName?}` —
the UI sends the token straight from a live hit event; tokens are never
persisted (the `hits` table stores them as null — expired by read time).

## No retries, no browser fallback (yet)

A failed travel surfaces as a `failed` event and stops there: the token is
single-context and the listing is usually gone. The lazy browser fallback
(master plan) stays unimplemented until the API path ever rejects in practice.
