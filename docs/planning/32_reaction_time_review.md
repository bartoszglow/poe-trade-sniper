# 32 — Reaction-time review (WS → hit → travel critical path)

**Status: reviewed + first wins IMPLEMENTED** (2026-07-01). Multi-agent latency review of the
product's core path. Verify green.

## Verdict

**Mostly optimized.** The single-listing path is tight: ~0 ms of _deliberate in-app delay_
(the rate-limit governor adds 0 ms to an isolated first fire — a cold slot = `now`), and
wall-clock is ~99 % two unavoidable GGG round-trips (`/fetch` for the token, then `/whisper`).
The one real defect was **burst handling**.

## Latency budget (WS frame → whisper leaves)

Clean case ~250–700 ms, ~99 % network. In-process avoidable ≈ the fsync (~1–8 ms). **Burst
case added ~600·(k−1) ms** — the dominant, avoidable cost.

## Shipped

- **C1 — burst coalescing** (`ws-engine.ts`). PoE2 pushes ONE `{"result":"<jwt>"}` per listing,
  so k near-simultaneous listings were fetched one-by-one, each paying the governor's ~600 ms
  fetch spacing. Now frames buffer and drain in a single in-flight fetch: the first fires
  immediately (0 added latency for a lone hit), trailing frames coalesce into the next batch
  (`fetchListings` already batches ≤10/call). Strictly _friendlier_ to the governor (fewer
  calls). Test: `ws-engine.test.ts`.
- **C3 — `PRAGMA synchronous = NORMAL`** (`migrate.ts`). WAL defaulted to FULL (fsync every
  commit, in front of the hit publish). NORMAL fsyncs only at checkpoint; DB stays consistent,
  worst case loses the last few _log rows_ on OS crash/power-loss (never app crash, never a
  token — #3). Saves ~1–8 ms per hit.
- **Instrumentation** (dev debug logs): governor slot-wait per policy (`rate-limit-governor.ts`);
  per-frame gap + queue depth + fetch-in-flight (`ws-engine.ts`). Sizes real bursts + measures
  serialization in the actual game, all in-process (no GGG surface, no token/#3 exposure).

## Parked (need data / a decision)

- **C2 — publish the hit _before_ the SQLite commit.** Saves the same ms as C3 but on every
  path; tradeoff: an app crash in the ~ms gap loses that hit's audit-log row. C3 already covers
  most of it — revisit only if instrumentation shows commits still on the hot path.
- **N1 — priority for a WS-triggered fetch inside the fetch bucket.** Only helps under
  multi-search reconnect contention (another search's poll grabbed the slot). Touches the
  load-bearing governor → park unless measured; must only _reorder within the same budget_.

## Do NOT touch (safety-mandated — do not "optimize" for latency)

- Governor spacing / slot reservation, 429 `pauseAll`, near-limit hold, `outbound-guard` — the
  load-bearing per-IP throttle (#4). A 429 stacks a 30-min lockout.
- `FETCH_SPACING_MS=600` / `TRAVEL_MIN_SPACING_MS=2000` — conservative throttles below the
  _observed_ (unverified, #2) caps; save **0 ms** on the clean path anyway. Don't lower without
  live-header proof, which we can't get (#8).
- `buyLock` / `processQueue` single-flight, `traveledListingIds` dedup, auto-travel opt-in,
  `TRAVEL_TOKEN_MAX_AGE_MS` (#3/#5).
- **`gameFocus.focus()` is fire-and-forget and MUST stay that way** — it races alongside the
  awaited whisper (0 ms on-path). Awaiting it would inject osascript latency right before the
  teleport. Latent regression to guard against.

## The WS layer itself

Already at the physical limit for _notification_: one persistent, authenticated push socket per
search (like a logged-in browser tab), no client keepalive ping (avoids GGG's 1008 close),
each frame handled in ~0.1 ms. We can't be told sooner than GGG pushes. The frame carries only
a fetch-JWT (a pointer, not the token), so the one `/fetch` round-trip after the push is
unavoidable. The real WS levers are: stay connected (reconnect ladder — don't fall back to
12 s polling) and coalesce bursts (C1) — both handled.
