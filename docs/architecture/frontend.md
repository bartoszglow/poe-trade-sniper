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

`src/shell/nav.ts` is the single registry: `{ id, path, label, icon, page }`.
Rail, routes and titles derive from it. Adding a page = adding an entry;
shell components never change.

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

## Data fetching

- `lib/api.ts` — typed fetch wrapper, **relative URLs only** (`/api/...`):
  Vite proxy in dev, same-origin in desktop.
- Realtime: one `EventSource` via a `useEventStream` hook (Phase 3) — SSE, not
  polling. `useHealth` polling is the bootstrap/fallback indicator.
