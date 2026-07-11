# Plan 46 — deal-watch BUY BELOW showed the GGG filter cap, not the deal cutoff

**Bug (operator):** a deal watch showed baseline 699 div, lowest 699 div, but
**BUY BELOW 836.2 div** with threshold "Amount below market = 30 divine". A
buy-below ABOVE the baseline is impossible for a below-market threshold — it
should be 699 − 30 = 669 div.

## Root cause

`DealPriceCard` rendered BUY BELOW from `persistedCutoffExalted`:

```
state.capExalted ?? computeClientCutoffExalted({mode,thresholdValue,unit}, baselineExalted)
```

`state.capExalted` is **not** the deal cutoff — it is the GGG price FILTER cap,
`cutoffExalted × (1 + DEAL_CAP_MARGIN_RATIO)` with margin 0.25 (env.ts). So
669 × 1.25 = 836.3 ≈ 836.2. The card showed the margin-widened query cap (the
buffer that keeps the self-created capped id stable across small baseline drift),
not the deal threshold. The variable name ("cutoff" holding "cap") gave it away.

Secondary: `computeClientCutoffExalted` returned `null` for absolute+**divine**
(it took no rate) — which is why the code leaned on `capExalted` in the first
place. But the client already receives the divine-rate snapshot
(`state.divinePriceExalted`, exposed in `DealPriceCard` as `divineRate`), so it
has everything needed to compute the true cutoff.

## The two real quantities (both legitimate, different concerns)

- **cutoffExalted** (the TRUE buy-below) = `baseline − thresholdExalted` = 669 div.
  Server source: `computeCutoffExalted` (deal-query.ts). Lives in the hot-path
  runtime snapshot; the client mirrors it for display/preview.
- **capExalted** (GGG `price.max` filter) = cutoff × 1.25. It is the actual query
  cap POSTed to GGG. No client component reads `state.capExalted` for display; the
  Purchase card shows the price bound by parsing the (already price-capped) query
  definition via `QueryCriteriaView`, so it correctly reflects the real filter —
  **left unchanged**.

## Fix (client-side; completes the existing cutoff mirror)

1. `computeClientCutoffExalted(config, baselineExalted, divineRate)` — add
   `divineRate`; absolute+divine → `baselineExalted − thresholdValue × divineRate`
   (null when the rate is null). Percent + absolute-exalted unchanged.
2. `DealPriceCard`: pass the already-in-scope `divineRate` to BOTH the draft
   preview and `persistedCutoffExalted`, and DROP the `state.capExalted ??`
   primary — the display now shows the true cutoff (669 div), not the filter cap.
3. `deal-watch-display.test.ts`: cover absolute+divine (baseline − rate×threshold)
   and the null-rate fallback.

### Second site — the row chip

The same conflation was in `DealWatchControl` (the SearchRow deal chip — the
`< 836.2 DIV` badge in the screenshot): `formatDealCutoffChip(state.capExalted, …)`.
Fixed identically.

To stop this bug class recurring, the "buy-below from a persisted state"
derivation is centralized in `cutoffExaltedForState(state)` (deal-watch-display)
— the single source both the chip and the detail card now use; neither reads
`state.capExalted`.

Purchase card + the GGG query cap stay as they are — they were correct. Only the
BUY BELOW readouts read the wrong field.

## Review (2026-07-11)

Scoped review (correctness / consistency / frontend / testing): **PASS**, no
blocking findings. Client↔server cutoff math confirmed identical across all three
modes; `state.capExalted` no longer read for display anywhere; regression pinned
with the exact reported numbers. Applied: CHANGELOG `Fixed` entry (S3);
`formatDealCutoffChip` param renamed `capExalted`→`cutoffExalted` (S4). Parked
(S4, non-blocking): hoisting the shared cutoff formula into `@poe-sniper/shared`
so client and server stop mirroring it (`computeClientCutoffExalted` ↔
`computeCutoffExalted` + `unitToExalted`) — a future consolidation, pre-existing
duplication, not this fix.
