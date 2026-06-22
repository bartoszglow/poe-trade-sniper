# GGG trade-API notes (evidence log)

The trade API is **undocumented**. Every behaviour below was observed live;
nothing here is official. Each entry carries the date it was last verified and
where the evidence came from. Assumptions in code are marked `TODO(verify)`.
**Never silently assume an endpoint shape — extend this file instead.**

Evidence source for all 2026-06-11 entries: the old `poe2-live-sniper` prototype
(since retired/archived), validated live that day.

## Endpoints

| Endpoint                                                     | Behaviour                                                                                                                                                                                                                                                                                                                                                                       | Verified   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `GET /api/trade2/search/<realm>/<league>/<id>`               | Resolves a bare search id → `{id, query}`. Lets the user paste a search URL/id and recover the query.                                                                                                                                                                                                                                                                           | 2026-06-11 |
| `POST /api/trade2/search/<realm>/<league>`                   | Body `{query, sort: {indexed: 'desc'}}` → `{result: ids[], total}`. Newest-first makes id diffing trivial.                                                                                                                                                                                                                                                                      | 2026-06-11 |
| `GET /api/trade2/fetch/<ids≤10>?query=<searchId>&realm=poe2` | Listing payloads incl. `listing.hideout_token` (securable only). Max 10 ids per call.                                                                                                                                                                                                                                                                                           | 2026-06-11 |
| `POST /api/trade2/whisper` body `{token}`                    | **Browser-free travel.** Requires `X-Requested-With: XMLHttpRequest` + Referer = the search page; without the header → 403 code 6 even from a logged-in context. Returns `{success: true}`. Bypasses the client-side "In demand. Teleport Anyway?" modal.                                                                                                                       | 2026-06-11 |
| `wss://…/api/trade2/live/<realm>/<league>/<id>`              | Push detection. Frames: `{"new": ["<listingId>", …]}`; anything else is keepalive/noise. **WORKING again as of 2026-06-12** (handshake + `active` verified live; was 504-down from ~patch 0.5.0 until a 2026-06 patch). Probe → poll fallback stays mandatory. **Tarpit:** unauthenticated handshakes hang forever — always send session cookies and enforce a connect timeout. | 2026-06-12 |

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

## Tokens & instant buyout

- Query filter `status: {option: "securable"}` = Instant Buyout listings.
  **Only securable listings** carry `hideout_token` (JWT, `tok:hideout`,
  TTL ~300 s) and a Travel button. Non-securable carry `whisper_token`
  (`tok:item`). Enforce/validate `securable` when a search is added if
  auto-travel is on. (2026-06-11)

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

## Adding entries

New discovery → add a row/bullet **with date + how it was observed** in the
same commit as the code that relies on it.
