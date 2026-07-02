# 34 — Live Hits panel: drag-to-resize + hide/show

**Status: IMPLEMENTED** (2026-07-02, approved in-session; commit id in git log —
`feat(shell): resizable + hideable live hits panel`). Web-only; no server changes.

The operator can resize the split between the middle content and the Live Hits
column by dragging a grip centered on the divider line, and hide the panel
entirely (button in the panel header; a persistent toggle in the AppBar brings
it back). Both prefs are per-device.

## Decisions (approved)

- **D-panel-1 — reopen control lives in the AppBar right cluster** (next to the
  WS/POLL pills): a persistent toggle at `lg+`, `PanelRightOpen/Close` icon,
  `.app-no-drag` inside the Electron drag region. StatusBar placement rejected.
- **D-panel-2 — "new hit while hidden" dot**: the AppBar toggle shows a gold dot
  when a NEW hit lands while the panel is hidden. Keyed off
  `lastHitAtBySearchId` (stamped by `hit` events only, never `hit-updated`
  re-serves) compared against the hide timestamp.
- **Persistence: localStorage, not server settings** — matches every other UI
  pref (`sniper.*` keys, one small module + custom-event sync; the
  `useNetworkView` pattern). Keys: `sniper.hitsPanelWidth`,
  `sniper.hitsPanelHiddenAt` (ISO timestamp doubles as the dot reference;
  absent = visible).
- **`lg+` only** — below 1024px the panel was already CSS-hidden with no
  reopen affordance; that behavior is unchanged. A mobile drawer would be its
  own feature (future_ideas if ever needed).

## Implementation

- `apps/web/src/lib/hits-panel-layout.ts` — constants (default 528px = the old
  33rem, min 320, max 720, viewport cap 45%, keyboard step 16px — tunable at
  the top), pure `clampHitsPanelWidth` (unit-tested), storage + subscribe.
- `apps/web/src/hooks/useHitsPanelLayout.ts` — thin React subscription.
- `apps/web/src/components/ResizeHandle.tsx` — atomic, reusable divider: slim
  grab strip overhanging the border, grip pill centered at 50% height, pointer
  capture, `role="separator"` + arrow-key resize + Enter/double-click reset,
  gold line feedback while grabbed/hovered/focused.
- `apps/web/src/shell/AppShell.tsx` — grid column becomes
  `lg:grid-cols-[3rem_1fr_var(--hits-panel-width)]` (variable from the hook);
  hidden → the column and the aside disappear, content takes full width.
  **Drag previews write the CSS variable directly on the grid node** (no React
  re-render per pointer move — the whole app hangs off that grid); the clamped
  width commits to storage on release. The aside's `overflow-hidden` moved to
  an inner wrapper so the handle can overhang the border line unclipped.
- `apps/web/src/shell/HitsPanel.tsx` — `PanelRightClose` button in the header.
- `apps/web/src/shell/AppBar.tsx` — the D-panel-1 toggle + D-panel-2 dot.
- i18n: `hitsPanel.hide|show|resize` EN+PL.

## Safety notes

- The live feed state lives in `EventStreamProvider` (root), NOT in the panel —
  hiding unmounts only the view; nothing is lost, sounds/notifications keep
  firing.
- Width is clamped on read too, so a stale stored value from a bigger monitor
  can't crush the middle content on a smaller one.

## Tests

`clampHitsPanelWidth` (band, viewport cap, rounding, tiny-viewport floor) in
`hits-panel-layout.test.ts`. Drag feel + toggle behavior verified by hand
(operator view, mockup-exempt).

## Hit → search spotlight (added 2026-07-02, `470b25f`)

Every hit card shows a **source-search chip** (the search's label, truncated,
shrinkable; hidden if the search is gone). Clicking it navigates to Searches
(no duplicate history entry when already there), **spotlights** the source row
— same gold glow and the same 60s window as a fresh hit — auto-expands its
collapsed room via the D-room-3 machinery (an explicit click even overrides a
manual mid-window suppression), and scrolls the row into view (effect re-arms
until the row exists, since the click usually arrives from another page; a
freshness guard stops an expired spotlight from scroll-jumping later visits).
**One spotlight at a time**: clicking a second hit replaces the first.
Collapsing the spotlit room via its chevron dismisses the spotlight (no reopen
fight; both checks read the server-confirmed layout, not the drag preview).
Store: session-scoped one-slot module (`apps/web/src/lib/search-spotlight.ts`,
unit-tested); `SEARCH_HIGHLIGHT_MS` is now the single shared 60s constant.
Shipped after an adversarial review (2 real defects fixed pre-commit: the
cross-page scroll never fired; a layout-source mismatch could reopen the
chevron fight after a failed reorder POST).
