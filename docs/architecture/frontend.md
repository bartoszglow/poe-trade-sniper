# Frontend

## Shell layout (decided 2026-06-12 with Bartosz)

Desktop-application layout, compact density, dark-only PoE-flavored theme:

```
┌─────────────────────────────────────────────────────┐
│ app bar — branding + live dot (frameless-ready)     │
├───┬─────────────────────────────┬───────────────────┤
│ i │ page content (router)       │ LIVE HITS panel   │
│ c │                             │ (persistent, lg+) │
│ o │                             │                   │
├───┴─────────────────────────────┴───────────────────┤
│ status bar — server · session · budget · version    │
└─────────────────────────────────────────────────────┘
```

- The **live hits panel is persistent** (right, lg+ viewports) — hits are the
  product and must never hide behind navigation. Below lg it collapses; the
  Hits page holds the full history.
- The **status bar** is the home for operational state (server, session,
  rate-limit budget, league, version).

## Electron readiness

The app bar is the future frameless-window drag region. `index.html` sets
`data-shell="web"`; the Phase 5 Electron preload switches it to `"desktop"`,
which activates (see `index.css`):

- `.app-drag-region` → `-webkit-app-region: drag` on the app bar,
- `.app-no-drag` for interactive elements inside it,
- `.app-window-controls` reserves the window-button corner.

Nothing else in the shell may assume a browser chrome exists.

## Nav registry (open/closed)

`src/shell/nav.ts` is the single registry: `{ id, path, labelKey, icon, page }`.
Rail, routes and titles derive from it. Adding a page = adding an entry;
shell components never change. `labelKey` is an i18n catalog key — hooks can't
run at module scope, so the rail resolves it with `useT()`.

## i18n (mirrors card-bridge)

English (`en`) and Polish (`pl`); the operator switches language from Settings
(persisted to `localStorage` under `sniper.language`, default `en`, `pl`
auto-detected from the browser locale).

> **Whenever you add text that is shown to the user, it MUST be a label in the
> message catalog with a translation for every supported language.**

- Catalog: `src/i18n/messages.ts`. `EN` is the source of truth for the key set
  (`as const` → `MessageKey`); `PL` is typed `Record<MessageKey, string>`, so a
  missing or stray key is a **build error**. Adding a language = one record +
  one `LANGUAGES` row (open/closed).
- Singular text — `useT()` → `t('key')`, `{name}` placeholders interpolate.
- Counted text — `useTn()` → `tn('searches.hitCount', count)`; plural forms
  resolve via `Intl.PluralRules` (Polish one/few/many). Never hand-build
  `count + (n === 1 ? '' : 's')`.
- Static data (nav entries, option lists) — store `labelKey`, translate inside
  the component.
- Outside the React tree (SSE hit → system notification) — `translateStatic()`
  reads the persisted language directly.
- Server-supplied detail strings (engine `statusDetail`, API error `message`,
  login-capture `detail`) render as-is — the server speaks English; translating
  free-form diagnostics would hide information.

## Atomic components

- Extract on **2nd use**; variants are **enums, never booleans**
  (`Badge tone`, `Button variant`).
- Semantic components build on atomic ones (`StatusDot` over raw spans;
  later `RarityName`, `PriceTag` over `Badge`).
- No hardcoded colors at call sites — components reference theme tokens only.

## Theme tokens

All tones live in the `@theme` block of `src/index.css`: surfaces
(`surface-0..3`), edges, ink (text), gold accent, status (`ok/warn/danger/info`)
and PoE rarity colors. Dark-only by design (operator tool, game companion); a
light theme would be a token-set swap, not a component change.

Density is compact: root font-size 14px, tight paddings — maximize visible
hits/searches in a small Electron window.

## Criteria view

`QueryCriteriaView` renders a resolved trade query ("what does this search
match"): item identity, purchase scope, price (gold), stat groups (AND/OR/
COUNT with disabled rows struck through) and filter groups. The parser
(`lib/query-criteria.ts`) follows one cardinal rule — **never hide data**:
unrecognized keys/groups render raw key + JSON, because the GGG query schema
is undocumented and evolves. Stat ids resolve through `useStatsDictionary`
(`GET /api/stats`, server-cached static game data; raw ids shown while it
loads or when no session exists). Used twice: an accordion on every search
row (filters ship with `GET /api/searches` — zero GGG cost) and the add-form
"Show criteria" preview (`POST /api/searches/preview` — resolve without
persisting, one governor-controlled GGG call per click).

## Data fetching

- `lib/api.ts` — typed fetch wrapper, **relative URLs only** (`/api/...`):
  Vite proxy in dev, same-origin in desktop.
- Realtime: one `EventSource` via a `useEventStream` hook (Phase 3) — SSE, not
  polling. `useHealth` polling is the bootstrap/fallback indicator.
