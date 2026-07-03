# 38 — Interactive price-check editor + Tier-2 tier/roll + item-text i18n

**Status: IMPLEMENTED (2026-07-03).** A: interactive editor — DONE + verified (server
parse/price split, filter registry, `PriceCheckEditor`, tests). C: i18n — lexicon-driven
parser + language detection DONE (EN verified; non-EN lexicons + per-language dictionary
host are `TODO(verify)`, need on-machine/live-GGG). B: Tier-2 — `TierDataService` loader +
merge + `buildDraft` annotation + editor surfacing + generator scaffold DONE; the actual
`.dat` decode/data-generation is an on-machine step (`scripts/build-tier-data.mjs`,
`TODO(verify)`). Evidence log for the unverified bits: `docs/integration/api-notes.md`.

Three linked price-check upgrades.
Guiding constraint from the operator: the editable field set is **large and grows
every GGG patch** — the design must be **data-driven off the trade dictionary**, never
a hand-maintained list of fields. Hard rules #2 (no guessing GGG) and #8 (no live
tests) still bind: the parts that need live GGG per-language data or game-file decoding
ship as machinery + EN/verifiable path, with the live-data step marked `TODO(verify)`.

---

## A. Interactive price-check editor (the main ask)

### Problem

Today a paste runs an auto-built query (every matched stat included, roll used as the
min, fixed tolerance) and returns a result. The operator wants to **pick which
stats/attributes to price and edit their values first** — and this must scale to
hundreds of stats + item attributes that GGG keeps adding.

### Core design — a filter registry, not hardcoded fields (open/closed)

The editable model is **derived** from the parsed item + the dictionary. Every editable
row is a `PriceCheckFilter` in a **discriminated union**, and each _kind_ is handled by a
registry entry that knows how to (1) render it (client) and (2) serialize it to a trade2
query fragment (server). Adding a new GGG property later = **add a registry entry**, not
edit a switch. Two kinds cover everything:

- `stat` — a dictionary-matched mod line. Carries `statId`, the `text` template, `type`
  (explicit/implicit/rune/…), and one `value` per `#` placeholder, each with an editable
  `{ value, min, max }`. Options-type stats carry the option list. **This is the growing
  set** — it comes straight from `/data/stats`, so new stats appear automatically.
- `attr` — a small, stable set of item-level filters resolved by an **attribute registry**
  (`ATTRIBUTE_FILTERS`): item level (min), quality (min), corrupted (bool), rarity, base
  type, gem level, sockets, etc. Each entry declares its label, how to read it off the
  parsed item, its input type, and its query serializer. New attrs = new registry entry.

### Shape (shared)

```
PriceCheckDraft { item, league, filters: PriceCheckFilter[], unmatched: string[] }
PriceCheckFilter =
  | { id, kind: 'stat', statId, text, statType, enabled, values: FilterValue[] }
  | { id, kind: 'attr', attr: string, label, enabled, input: FilterInput }
FilterValue = { placeholder: number, value: number|null, min: number|null, max: number|null }
FilterInput = { type: 'number-min'|'range'|'bool'|'option'|'text', value, min, max, options? }
```

Defaults on parse: matched stats `enabled:true` with `min = rolled value`, `max = null`;
attrs `enabled:false` (opt-in) except a known base type which defaults on.

### Endpoints (split parse from price)

- `POST /api/price-check/parse { itemText, league? }` → `PriceCheckDraft`. **No GGG query,
  no budget** — parse + match + build the default draft.
- `POST /api/price-check/price { league, filters, meta }` → `PriceCheckResult`. Build the
  query from the **enabled + edited** filters (via each registry entry's serializer) and
  run the budget-gated search / aggregator, persisting to history as today.
- `POST /api/price-check { itemText }` (existing, hotkey/overlay one-shot) stays: it now
  = parse → price-with-defaults internally, so the overlay path is unchanged.

`query-builder.ts` refactors to `buildQueryFromFilters(filters, league, meta)` that the
registry serializers feed; the old `buildQuery` becomes the default-draft producer.

### Client — `PriceCheckEditor` (dynamic form)

Maps over `draft.filters`, rendering each via a **renderer registry keyed by kind** (mirror
of the server serializer registry): a checkbox + the stat text with inline number inputs
per `#`, min/max, option selects, bool toggles. Unmatched lines shown greyed (informational).
A "Price it" button POSTs the current selections. Lives in the **Price Checks view** (paste
→ editor → result + history) and reused in the **Settings bench**. The overlay/hotkey path
keeps the one-shot result (no editor on the transparent overlay).

### Decisions

- **D-ed-1** parse/price split (editor needs a no-budget parse; keeps the one-shot path).
- **D-ed-2** filter **registry** (render+serialize per kind) so new GGG fields are additive.
- **D-ed-3** defaults: stats on (min = roll), attrs off (opt-in), known base on.
- **D-ed-4** editor in the in-app views only; overlay stays one-shot (no editing on a
  click-through window).

---

## B. Tier-2 — tier / roll analytics (from game files)

### Goal

For a matched stat roll, show its **tier** and the tier's **roll range** for the item's
base/ilvl (e.g. "+54 to maximum Life → T2 (52–60)"). Data lives in the game bundles, not
the trade API.

### Approach

- A **build-time generator** `apps/server/scripts/build-tier-data.mjs` using
  `pathofexile-dat` to fetch the current patch's bundles from GGG's **public patch CDN**,
  decode `Mods` / `Stats` / base-item tables, and map mod tiers → trade `statId`s (match on
  stat hash / normalized text). Emits `apps/server/data/tier-data.json`
  (`{ dataVersion, stats: { [statId]: { tiers: [{tier,min,max}] } } }`).
- The dictionary schema **already reserves** `StatDef.tiers?` / `ItemDef.properties?`
  (`dictionary-schema.ts`). `TradeDataService` loads `tier-data.json` if present and merges
  `tiers` onto stats after the Tier-1 fetch; absent file → Tier-1 unaffected (graceful).
- Surface `tiers` in the editor/result: annotate a matched stat's roll with its tier.

### Honesty / validation

Running the generator needs the CDN reachable + correct binary decode + a heuristic
tier↔trade-stat mapping — **cannot be validated here** (no game files, rule #8). Ships as:
generator script + loader/merge + UI surfacing + an **empty/committed sample** `tier-data.json`
schema; the real data generation is an **on-machine run** (documented). `DICTIONARY_SCHEMA_VERSION`
bumps when real tier data is generated so every user rebuilds.

### Decisions

- **D-t2-1** build-time generation (not runtime) — shipped as data, lagging never breaks core.
- **D-t2-2** merge onto the existing reserved fields; graceful absence.
- **D-t2-3** generator is an on-machine step; commit the loader + schema + a stub file.

---

## C. Item-text i18n

### Goal

Parse item text in the operator's client language (GGG copies localized text).

### Approach

- **Language-parametrized dictionary**: `TradeDataService` keyed by language; fetch
  `/api/trade2/data/stats` from the language host (GGG serves localized trade data on
  language subdomains, e.g. `de.pathofexile.com` — `TODO(verify)`, documented in
  `api-notes.md`, no live probe). Cache per language in `app_state`.
- **Language detection** from the localized header labels (`Item Class:` /
  `Rarity:` are translated — e.g. `Gegenstandsklasse:` / `Seltenheit:`). A small
  `LANGUAGE_HEADERS` registry maps the label → language; default EN.
- Parser + stat-matcher take a `language`; the compiled matchers come from that language's
  dictionary.

### Honesty / validation

The non-EN dictionary fetch host + the exact localized header labels **need live GGG**
(rules #2/#8). Ships as: language-param plumbing end-to-end, an EN path fully working, a
seeded `LANGUAGE_HEADERS` map (best-effort from public knowledge, `TODO(verify)`), and the
non-EN fetch behind the documented assumption. Detection falls back to EN safely.

### Decisions

- **D-i18n-1** language is a parameter threaded through dictionary→parser→matcher.
- **D-i18n-2** detect from header labels (registry), default EN; never fail a parse on an
  unknown language — fall back to EN.
- **D-i18n-3** non-EN host + labels marked `TODO(verify)`; EN is the verified path.

---

## Sequencing

A (editor, fully verifiable) → C (i18n plumbing) → B (Tier-2 machinery) → adversarial
review → fixes → `pnpm verify` → commit in logical groups.
