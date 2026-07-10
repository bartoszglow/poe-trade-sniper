# GGG trade-API notes (evidence log)

The trade API is **undocumented**. Every behaviour below was observed live;
nothing here is official. Each entry carries the date it was last verified and
where the evidence came from. Assumptions in code are marked `TODO(verify)`.
**Never silently assume an endpoint shape — extend this file instead.**

Evidence source for all 2026-06-11 entries: the old `poe2-live-sniper` prototype
(since retired/archived), validated live that day.

## Endpoints

| Endpoint                                                     | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Verified   |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `GET /api/trade2/search/<realm>/<league>/<id>`               | Resolves a bare search id → `{id, query}`. Lets the user paste a search URL/id and recover the query.                                                                                                                                                                                                                                                                                                                                                                                                                              | 2026-06-11 |
| `POST /api/trade2/search/<realm>/<league>`                   | Body `{query, sort: {indexed: 'desc'}}` → `{result: ids[], total}`. Newest-first makes id diffing trivial.                                                                                                                                                                                                                                                                                                                                                                                                                         | 2026-06-11 |
| `GET /api/trade2/fetch/<ids≤10>?query=<searchId>&realm=poe2` | Listing payloads incl. `listing.hideout_token` (securable only). Max 10 ids per call.                                                                                                                                                                                                                                                                                                                                                                                                                                              | 2026-06-11 |
| `POST /api/trade2/whisper` body `{token}`                    | **Browser-free travel.** Requires `X-Requested-With: XMLHttpRequest` + Referer = the search page; without the header → 403 code 6 even from a logged-in context. Returns `{success: true}`. Bypasses the client-side "In demand. Teleport Anyway?" modal.                                                                                                                                                                                                                                                                          | 2026-06-11 |
| `wss://…/api/trade2/live/<realm>/<league>/<id>`              | Push detection. Frames (per `live-message.ts`): PoE2 emits a per-listing fetch **JWT** `{"result": "<jwt>"}` passed straight to `/fetch/<jwt>` (legacy PoE1 `{"new": ["<listingId>", …]}` also accepted); anything else is keepalive/noise. **WORKING again as of 2026-06-12** (handshake + `active` verified live; was 504-down from ~patch 0.5.0 until a 2026-06 patch). Probe → poll fallback stays mandatory. **Tarpit:** unauthenticated handshakes hang forever — always send session cookies and enforce a connect timeout. | 2026-06-12 |

## Trade website (human-facing) URLs

The desktop UI links out to the trade site. Evidenced format — the same segments the
resolve/live endpoints and the whisper `Referer` use (and `search-input.ts` parses back
in): the search PAGE is
`https://www.pathofexile.com/trade2/search/<realm>/<urlEncodedLeague>/<searchId>`.
Single-sourced in `packages/shared/src/trade-url.ts` (`tradeSearchPageUrl`); the server's
whisper `searchPageUrl()` now delegates to it. (2026-07-01)

**No per-listing deep link.** Nothing observed lets a trade-site URL target a single
listing, and the only per-listing id we hold (`listingId`) is ephemeral/re-served (see the
retry note below + `offer.ts`). Links are therefore search-level only — a live hit can link
to its search page, not to the exact item. Do not construct a per-listing URL without adding
verified evidence here first (hard rule #2).

## Purchase type — `status.option` values

The trade-site status dropdown offers five purchase types. API values mapping
(domain `PurchaseMode` → query `status.option`):

| Dropdown label               | Domain value                 | `status.option` | Status                  |
| ---------------------------- | ---------------------------- | --------------- | ----------------------- |
| Instant Buyout               | `instant`                    | `securable`     | **Verified 2026-06-11** |
| Instant Buyout and In Person | `instant_and_in_person`      | ?               | `TODO(verify)`          |
| In Person (Online in League) | `in_person_online_in_league` | ?               | `TODO(verify)`          |
| In Person (Online)           | `in_person_online`           | ?               | `TODO(verify)`          |
| Any                          | `any`                        | ?               | `TODO(verify)`          |

Capture plan: once a valid session is imported, save one trade-site search per
dropdown option and call the resolve endpoint — the returned query carries the
real `status.option` value. Until then the server only overrides a query's
status for verified mappings; unverified modes keep the resolved query as-is
(with a warning).

**League list — VERIFIED 2026-06-12 (live probe with session):**
`GET /api/trade2/data/leagues` → 200
`{result: [{id, realm: "poe2", text}]}` — `id` is the URL league segment
(observed: "Runes of Aldur", "HC Runes of Aldur", "Standard", "Hardcore").
Served to the UI via cached `GET /api/leagues`.

## Price-check buy whisper — `listing.whisper` (`TODO(verify)`)

- The `/fetch` listing object is expected to carry a pre-templated buy whisper
  string (`listing.whisper`, e.g. `@Seller Hi, I would like to buy your …`), the
  same object the detection normalizer already reads `hideout_token` from. The
  price-check path captures it (`RawTradeListing.whisper`) and the UI offers a
  copy-to-clipboard so the operator can contact a comparable-listing seller. **Not
  yet live-verified** (hard rule #8 forbids a live probe here) — marked
  `TODO(verify)` in `trade-api.client.ts`; confirm the exact field name/shape from
  a recorded fetch payload and update this note. Absent field → the copy button
  simply doesn't render (null-safe). (2026-07-03)

## Item-text i18n — localized labels + per-language dictionary (`TODO(verify)`)

- The Ctrl+C parser is lexicon-driven (`item-language.ts`, #38 C): each language has a
  `ParserLexicon` of localized section labels (`Item Class:` / `Rarity:` / `Item Level:` /
  `Quality:`), status words (`Corrupted` / `Unidentified`), non-mod prefixes and domain
  tags. **EN is the only VERIFIED lexicon.** Non-EN lexicons are stubs whose
  `Item Class:` / `Rarity:` labels are seeded from public knowledge to drive language
  DETECTION, but their full field labels/status words/domain tags + a per-language stat
  dictionary are `TODO(verify)` — they need GGG's exact localized strings, which we can't
  probe here (hard rules #2/#8). Detection falls back to EN, so an unknown language never
  breaks a parse.
- **Per-language dictionary host — unverified.** GGG is understood to serve localized trade
  data on language subdomains (e.g. `de.pathofexile.com/api/trade2/data/stats`); this host
  scheme is `TODO(verify)` and NOT yet wired into `TradeDataService` (EN host only). Enabling
  a language for real matching = populate its lexicon + fetch its dictionary from the verified
  host. (2026-07-03)

## Tier-2 tier/roll data — game bundles via `pathofexile-dat` (`TODO(verify)`, on-machine)

- Per-stat tier/roll ranges live in the game bundles, NOT the trade API. `data/tier-data.json`
  (`{ dataVersion, stats: { [tradeStatId]: [{tier,min,max}, …] } }`) is generated ON-MACHINE by
  `apps/server/scripts/build-tier-data.mjs` (fetches GGG's public patch CDN + decodes `.dat` via
  `pathofexile-dat`) — it cannot run in the agent sandbox. Output lands in the gitignored `data/`
  dir (a local artifact like the DB — NOT committed; ship as an extraResource when packaging), so
  it is absent on a fresh checkout until generated. `TierDataService` loads that JSON when present
  and annotates a matched stat's roll with its tier; absent/empty file →
  tiers simply unavailable (core check unaffected). The hash→trade-stat-id mapping + base/ilvl
  keying are `TODO(verify)` against live bundles (hard rule #2). Ranges are approximate until
  keyed by base + ilvl. (2026-07-03)

## Tokens & instant buyout

- Query filter `status: {option: "securable"}` = Instant Buyout listings.
  **Only securable listings** carry `hideout_token` (JWT, `tok:hideout`,
  TTL ~300 s) and a Travel button. Non-securable carry `whisper_token`
  (`tok:item`). Enforce/validate `securable` when a search is added if
  auto-travel is on. (2026-06-11)
- **Retry needs re-resolution, not the stored token (2026-07-01).** The `hideout_token`
  comes only from the FETCH payload and dies at ~300 s; it is never persisted. Result ids
  are ephemeral (GGG re-serves the same offer under fresh result-hash ids — see
  `packages/shared/src/offer.ts`), so a stored id is not a durable handle. To retry travel
  on an aged hit, re-resolve: re-`fetch` the known id (Tier 1), else re-run the search and
  match the offer by `offerKey` (Tier 2). `TODO(verify)`: whether a recently-issued id stays
  fetchable long enough for the cheap Tier-1 refresh to reliably re-issue a token — needs a
  recorded/mock probe (never live, hard rule #8); Tier 2 (re-search) is the reliable path.
- **Whisper (travel) failure codes — observed.** The whisper endpoint returns a JSON error body
  `{error: {code, message}}` on failure. Observed live:
  - `404 code 1` → `"Item no longer available"` — the listing sold/vanished (the common case;
    even a just-re-fetched id whispers 404 once the item is gone). Observed 2026-07-01.
  - `400 code 2` → **three distinct blockers under one code**, split by message text (verbatim
    server logs 2026-07-07/08; counts from a live session). GGG's docs say "use the code, not the
    message" (message is subject to change), but here the code is identical for genuinely different
    states, so `classifyTravelFailure` makes a deliberate, evidence-backed exception: it matches the
    message case-insensitively, and an unrecognised code-2 message falls through to `unknown` rather
    than mislabelling. None are auto-retried (all need an operator action first; the manual Retry
    button stays):
    - `"…Your account must be in-game to use this feature"` → `not_in_game` (PoE closed / at login).
    - `"…You must be in a town or Hideout area to secure items"` → `not_in_town` (in-game but on a
      map — travel only works from town/hideout).
    - `"…You cannot secure items that you are selling yourself"` → `own_listing` (auto-travel hit
      your own listing).
  - `403 code 6` → `"Forbidden"` — a missing `X-Requested-With` / wrong Referer (see the whisper
    row above). A _format_ problem, not a business one.
    These are mapped to a stable UI reason by `classifyTravelFailure` (`packages/shared/src/travel-failure.ts`,
    registry-style); `429` → rate-limited; anything else stays `unknown`. Add a new code there only
    with evidence here (hard rule #2).
  - **Official GGG error-code enum** (authoritative — from the public dev docs,
    `pathofexile.com/developer/docs/index#errors`, fetched 2026-07-07; the whisper endpoint
    reuses this envelope, so `error.code` means the same). GGG explicitly says _"use the code
    rather than the message as the message is subject to change"_ — which is exactly why we key
    `classifyTravelFailure` on the code:

    | code | meaning                 | code | meaning                 |
    | ---- | ----------------------- | ---- | ----------------------- |
    | 0    | Accepted                | 6    | Forbidden               |
    | 1    | Resource not found      | 7    | Temporarily Unavailable |
    | 2    | Invalid query           | 8    | Unauthorized            |
    | 3    | Rate limit exceeded     | 9    | Method not allowed      |
    | 4    | Internal error          | 10   | Unprocessable Entity    |
    | 5    | Unexpected content type |      |                         |

    So the asked-about **3 = Rate limit exceeded, 4 = Internal error, 5 = Unexpected content type**.
    `classifyTravelFailure` now maps these too (by code, per GGG's guidance): 3 → `rate_limited`,
    4 → `server_error`, 5 → `bad_response`. Retry policy is driven by `isRetryableTravelFailure`:
    the transient/indeterminate ones (`server_error`, `bad_response`, `unknown`, and a null reason)
    get one automatic retry; the definitive ones (`item_gone`, `not_in_game`, `rate_limited`,
    `forbidden`) do not. Codes 7/8/9/10 remain unmapped → `unknown` (still auto-retried once); the
    server warn logs the raw `HTTP <status>: <message> (code N)` so a real occurrence surfaces there.

## Auth & session

- `POESESSID` is a **session cookie** — it dies with the browser profile, and
  guests get one too. Login signal = `GET /my-account` returning 200, NOT the
  cookie's presence. Capture the **full cookie set** (incl. `cf_clearance`)
  plus the **matching User-Agent** while the session is alive. (2026-06-11)
- Cloudflare blocks headless/bare-automation Chromium (Turnstile loop). Works:
  real Chrome channel with hidden automation flags, started at the homepage
  (not `/login`); or — desktop — a real Electron `BrowserWindow`. (2026-06-11)

## Rate limits

- Per-IP, **dynamic** — read `X-Rate-Limit-*` response headers, never
  hardcode. Observed search policy ≈ `60:300:1800` (changes!). Search, fetch
  and whisper have **separate policies**. Lockouts **stack on retry**; on 429
  pause ALL polling for `Retry-After`. (2026-06-11)
- Scheduler consequence: one shared budget governor; round-robin one
  search-POST per tick across all watched searches; cap fresh ids processed
  per round (a broad search at peak can turn over 100+ per poll). (2026-06-11)

## Item payload

- `item.properties` / `requirements` / `implicitMods` / `explicitMods` /
  `runeMods` / `craftedMods`; display strings carry `[tag|display]` markup to
  strip. Normalization lives in `items/` (`normalizeItemDetail`,
  `cleanMarkup`). (2026-06-11)
- **Mod arrays are NOT always `string[]`.** The same item can return
  `implicitMods` as plain strings **and** `explicitMods` as **objects** of the
  form `{ description, hash, mods: [{ magnitudes: [{ min, max }] }] }` — the
  object form appears alongside an `item.extended` block (`{mods, hashes}`) and
  carries roll ranges. `description` holds the same `[tag|display]` display text.
  The normalizer now reads the string OR `description` and `cleanMarkup`s it
  (`normalizeMods`); roll magnitudes are currently **discarded** (domain model
  is `string[]`). Evidence: live capture of a Unique listing, 2026-06-23 —
  `implicitMods: ["20% increased [StunThreshold|Stun Threshold]"]`,
  `explicitMods: [{description:"+54 to maximum Life", hash:"stat.explicit.stat_3299347043", mods:[{magnitudes:[{min:"40",max:"60"}]}]}, …]`.
  Before this fix, `explicitMods.map(cleanMarkup)` fed an object to
  `String.replace` and the uncaught throw crashed the whole server. (2026-06-23)

## Data endpoints (`/api/trade2/data/*`) — price-check dictionary (#37)

- `GET /api/trade2/data/{stats,items,static,filters}` are public JSON, the same
  payloads the official trade site loads. `stats` → `{result:[{label, entries:
[{id:'explicit.stat_…', text:'+# to maximum Life', type, option?:{options}}]}]}`;
  `items` → `{result:[{id:category, entries:[{name?, type, text, flags?:{unique}}]}]}`
  where a UNIQUE has `name` (+ `type`=base) and a plain BASE has only `type`.
  Live-observed 2026-07-02 (poe2): 8206 stats, 3566 items (3102 bases + 464
  uniques), 780 statics. Base coverage is complete — rare/magic base types like
  "Gold Ring" resolve. `TradeDataService` caches this as the versioned
  `TradeDictionary`.

## Currency Exchange (bulk) — `POST /api/trade2/exchange/<realm>/<league>` (D-dw-21)

Probed live 2026-07-10 (Runes of Aldur) via a throwaway `/api/dev/exchange-probe`
(removed after evidence). This is the GGG-native rates source that replaced
poe2scout for deal-watch when the aggregator's API vanished (see below).

- **Request** (works as-is, no browser headers needed):
  `POST /api/trade2/exchange/poe2/<league>` body
  `{"query":{"status":{"option":"online"},"have":["divine"],"want":["exalted"]},"sort":{"have":"asc"},"engine":"new"}`
  → 200. `have` = what the buyer pays, `want` = what the buyer receives.
- **Rate-limit policy is its OWN bucket**: `x-rate-limit-policy: trade-exchange-request-limit`,
  rules `Account 3:5:60` + `Ip 7:15:60, 15:90:120, 45:300:1800` — separate from the
  search policy (three probe POSTs moved only this policy's state counters). Keyed
  `'exchange'` in the governor; headers teach the rest.
- **Response**: `{id, complexity, result: {<hash>: {id, item: null, listing:
{indexed, account: {name, online: {league, status}}, offers: [{exchange:
{currency, amount, whisper}, item: {currency, amount, stock, id, whisper}}],
whisper, whisper_token}}}` — `offers[].exchange` = the buyer's cost,
  `offers[].item` = what the buyer receives (with the seller's `stock`).
- **`sort:{have:'asc'}` = best-for-buyer first**, and the book is decoy-heavy:
  observed sell-divine book `1 div → 500 ex (stock 13155)` — the real wall — then
  `360/350/321` and a scam tail of `1 div → 1 ex (stock 6600)`; buy-divine book
  had a `5 ex → 1 div (stock 7)` bait before the real `550 ex (stock 135)`. A
  plain top-N median therefore LIES; `ExchangeRatesService` uses a STOCK-WEIGHTED
  median per side and prices divine as the mean of both sides (evidence day:
  sell 500 / buy 550 → 525; poe2scout had said 714 five days earlier — the rate
  really moved, that was not sort confusion).
- Multi-currency `have`/`want` arrays: UNTRIED (`TODO(verify)`) — production
  fetches one pair per POST (3 POSTs per league per 15-min TTL: divine both
  sides + chaos buy side), which the separate exchange budget absorbs easily.
- Consequence for baselines: only divine/chaos (+ exalted at 1) normalize now;
  listings priced in other currencies are excluded as unpriceable (conservative —
  they were poe2scout-converted before).

## poe2scout aggregator (`api.poe2scout.com/api`) — NON-GGG, off the budget (#37)

- **2026-07-10 OUTAGE / API REMODEL: every route under `api.poe2scout.com` now
  404s** (`/api/poe2/Leagues`, `/api/poe2/leagues`, `/api/poe2`, `/api`, even the
  API root; the website itself is 200). Deal-watch rates moved to the GGG
  Currency Exchange above (D-dw-21); `Poe2ScoutClient`'s rate methods are dead
  code kept only until the price-check name-lookup (#37) is reworked against
  whatever their new API turns out to be — until then price-check name lookups
  degrade to "unpriced" (best-effort posture already handles it).
- Base `https://api.poe2scout.com/api`. Realm `poe2`. Routes (verified 2026-07-03
  via the live openapi.json): `GET /poe2/Leagues` → `[{Value, IsCurrent,
DivinePrice, BaseCurrencyApiId}]` (base is `exalted`); `GET /poe2/Leagues/
{League}/Items?search=&page=&perPage=` → `[{Name, Type, Text, CurrentPrice}]`
  (uniques/bases, price in exalted); `GET /poe2/Leagues/{League}/Currencies/
ByCategory?Category=currency&perPage=` → `{Items:[{Text, ApiId, CurrentPrice}]}`.
  Prices are per-LEAGUE — the current temp league (e.g. "Runes of Aldur"), NOT
  "Standard". Evidence 2026-07-03: Divine Orb = 737 exalted, Andvarius = 20
  exalted in Runes of Aldur. Earlier guesses (`poe2scout.com/api/items/search`)
  all 404'd — that was the bug behind "item not recognized" for currency/uniques.
- **League for a price check** = the league the operator plays, taken from
  watched searches (`SearchManager.getPrimaryLeague()`), NOT `DEFAULT_LEAGUE`
  ('Standard'). Applies to BOTH the trade2 rare search and poe2scout, so both
  price in the right league. **Fallback when there are NO searches** (2026-07-03):
  `Poe2ScoutClient.currentLeague()` reads `GET /Leagues` and picks the entry with
  `IsCurrent: true` (else the first), so a first-time user still prices against the
  live temp league before adding any search; config `'Standard'` is only the last
  resort.

## Self-created searches + price filters — Phase 0 probe for deal-watch (plan 41)

All observed live 2026-07-05 via a throwaway `DEAL_PROBE=1` dev controller
routing through `TradeApiClient` (governor + guard intact). Probe subject:
Barrage gem queries in "Runes of Aldur". Raw results archived in the session
scratchpad; summarized here as the durable evidence.

- **POST `/api/trade2/search/<realm>/<league>` returns a search id.** Response is
  `{id, result: ids[], total}` — the `id` field (e.g. `5nv8453oTa`) is a real
  saved-search slug, not a request token. This upgrades the 2026-06-11 entry
  (which recorded only `{result, total}`). (2026-07-05)
- **Ids are content-addressed / deterministic.** POSTing the _identical_ query
  twice returned the _same_ id both times. Re-POSTing an unchanged query is
  idempotent — no id churn, no growing trail of abandoned ids; only a changed
  query mints a new id. (2026-07-05)
- **Created ids round-trip.** `GET /api/trade2/search/<realm>/<league>/<id>` on a
  self-created id returns the exact query POSTed (price filter and status
  intact). (2026-07-05)
- **Created ids are live-watchable.** `wss…/api/trade2/live/<realm>/<league>/<id>`
  connected and authed on a self-created id (watched via the app: engine `ws`,
  detail "live websocket connected"). The full deal-watch premise — build query →
  POST → id → resolve → fetch → live ws — is proven end-to-end. (2026-07-05)
- **Id lifetime**: P0.2b interim (2026-07-05 ~03:10): both a live-watched id
  (`5nv8453oTa`, ws-connected for ~2 h) and an idle never-watched id
  (`eR5lGDJrIL`) still GET-resolve ~2 h after creation with filters intact.
  Content-addressing (P0.7) also means a "lost" id is always re-mintable by
  re-POSTing the identical query — id expiry is a recoverable, not fatal,
  condition. Multi-day aging still `TODO(verify)`: re-resolve both ids on a
  later day and extend this bullet.
- **`trade_filters.price` is accepted when POSTed** (previously only ever parsed
  from resolved queries): `{filters:{trade_filters:{filters:{price:{max,option?}}}}}`.
  (2026-07-05)
- **Price-cap currency semantics** (load-bearing for deal-watch):
  - `option: '<currency>'` → **literal** match: only listings priced in that
    exact currency. Cap `{max:1000, option:'exalted'}` matched 0 of 3 listings
    priced `1 divine` (~714 ex).
  - **`option` absent → value-converted match in the league base currency
    (exalted)**: cap `{max:1000}` matched all 3 `1 divine` listings. GGG converts
    at its own internal rate.
  - Barter-priced listings (e.g. `99 waystone-10`) are **excluded** from
    converted caps (unpriceable in currency terms). (2026-07-05)
- **`sort {price:'asc'}` is accepted and orders cross-currency by value**
  (`1 divine` × 3 → `1 mirror` → barter listings last). Backfills the missing
  evidence for the #37 price-check sort. (2026-07-05)
- **`status {option:'online'}` is accepted but DRASTICALLY narrows results** —
  evidence 2026-07-05: the identical uncapped Twister query (gem_level ≥21,
  quality ≥23, 5 sockets) returned **2** listings with `online` vs **56** with
  the search's own `securable` (operator's hand-made search `4mmRQVvZt9`).
  Interpretation: trade2's status domain is the purchase-type set (see the
  table above), and instant-buyout listings from OFFLINE sellers — most of the
  high-end gem market — do not match `online`. Consequence: deal-watch
  baselines keep the definition's own status (never force `online`); the #37
  price-check builders still POST `online` for rare comparables — their sample
  may be similarly over-narrowed, follow-up decision parked (a conservative
  narrow sample is not wrong for pricing, but it is for market coverage). (2026-07-05)
- **Rate-limit policy `trade-search-request-limit` has an Account rule** besides
  Ip: observed `x-rate-limit-account: 3:5:60` with `x-rate-limit-rules:
Account,Ip`, and Ip tiers `8:10:60, 15:60:120, 60:300:1800`. The governor
  already parses per-rule headers generically. (2026-07-05)
- **Invalid/expired id signals**: GET-resolve of a bogus id → clean **404**;
  `/fetch?query=<bogus>` → **200 with null-filled result entries** (silent
  failure). Expiry detection must use GET-resolve (or the ws handshake), never
  fetch-result emptiness. (2026-07-05)
- **`listing.whisper` + `whisper_token` keys confirmed present** on a live /fetch
  listing object (`method, indexed, stash, price, account, whisper,
whisper_token`) — partially closes the 2026-06-24 `TODO(verify)` (key exists;
  copy-whisper content still needs a real buy attempt).
- **poe2scout `ApiId` == GGG listing currency code** (`divine`, `mirror`, `chaos`,
  `annul`, `vaal` all match; `DivinePrice` 714.3 ex live) — the exchange-rate map
  for deal-watch normalization is a direct ApiId-keyed lookup. (2026-07-05)
- **Live price-fixer specimen**: the single online listing for a 21/20%/5s
  Barrage was priced `1 mirror` (~4.5M ex) — the "cheapest listing" of an
  illiquid item can be pure noise; robust median baseline is mandatory
  (plan 41 D-dw-2). (2026-07-05)

## Adding entries

New discovery → add a row/bullet **with date + how it was observed** in the
same commit as the code that relies on it.
