# 42 — Unified search detail panel

**Status: PLAN / mockup (2026-07-05).** Design-first — no implementation until the
operator picks Q1/Q2 below. Mockup: `docs/mockups/search-detail-panel.html`
(desktop + mobile, two states: deal enabled / empty-state, working chart hover).

## Problem

A single search's truth is spread over three surfaces that grew independently:

1. the row's expandable section — item criteria only (`QueryCriteriaView`);
2. the edit modal — label + id/URL;
3. the `DealWatchModal` — the whole deal-price feature (config, baseline, trend,
   actions).

Operator asked (2026-07-05) to merge them into ONE expandable per-row view.

## Design (what the mockup shows)

One expandable **detail panel** per row (the existing criteria chevron becomes the
panel toggle). Inside, a responsive card grid:

| Card                        | Content                                                                                                                                                                                                                                                              | Desktop                       | Mobile order |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------ |
| **Przedmiot**               | today's `QueryCriteriaView` + a note when deal mode holds the original price filter                                                                                                                                                                                  | left column                   | 3            |
| **Deal price**              | inlined `DealWatchModal` content: status badge, mode/threshold/unit form with live cutoff, baseline stat tiles (market price, raw lowest, sample/seen, refreshed-ago), actions (save / refresh-with-cooldown / disable via ConfirmDialog); empty state = enable form | right column                  | 1            |
| **Historia ceny**           | the baseline-history chart, upgraded from the modal sparkline to a full-width line chart (y-axis labels, crosshair + tooltip, ringed re-derive markers, change-over-window label)                                                                                    | full width                    | 2            |
| **Ustawienia** _(Q1 — TBC)_ | label + id/URL inline (id locked while deal mode on)                                                                                                                                                                                                                 | full width, dashed = optional | 4            |

Row header stays as today (drag, label, ext-link, badges, switches, archive,
delete). The DEAL chip remains the at-a-glance status; clicking it expands the
panel and scrolls to the deal card (no popup).

## Consequences / migration

- `DealWatchModal` content is **extracted into section components** and the modal
  is removed; `DealWatchControl` keeps only the chip/ghost-button + expand logic.
  ConfirmDialog for disable stays a dialog (destructive).
- The edit modal is absorbed by the settings card **iff Q1 = yes**; otherwise it
  stays and the settings card is dropped.
- Deal-history fetch moves from modal-open to panel-expand (same endpoint,
  watchId-keyed state as today).
- `SearchesPage.tsx` (god-file) sheds row-inline UI: new
  `components/SearchDetailPanel.tsx` + section components own the panel;
  criteria expansion state generalizes to panel expansion (per-row, multiple
  open allowed — Q2).
- Chart follows the dataviz mark/interaction specs already used by the sparkline
  (single gold series, ringed re-derive markers, crosshair+tooltip, table-view
  fallback for a11y).

## Decisions (operator, 2026-07-05)

- **Q1 = YES** — the settings card absorbs label/id editing; the edit modal is
  removed (id input locked while deal mode is on, as today's 409 guard).
- **Q2 = YES** — multiple panels may be open at once.
- **Q3 = YES** — live-hits locate auto-expands the panel at the deal card.
- **D-42-1 (operator)** — the WHOLE row header is the expand/collapse trigger:
  clicking anywhere on it toggles the panel, except interactive controls
  (switches, buttons, links, inputs, the drag handle). The chevron stays as the
  accessible, aria-expanded toggle; the row-wide click is a pointer convenience
  and must not fight dnd-kit drag activation. Expand/collapse animates
  (~200 ms ease-out via the grid 0fr→1fr technique, well under 0.5 s);
  prefers-reduced-motion disables the animation.

## Phasing

1. Extract DealWatchModal internals → section components (no behavior change).
2. Build `SearchDetailPanel` + wire the chevron/chip; drop the modal.
3. Chart upgrade (axis labels, wider layout, table fallback).
4. Settings card per Q1; edit-modal removal if absorbed.
5. Adversarial review (frontend + correctness lenses) → fixes → verify → commit.
