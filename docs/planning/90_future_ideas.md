---
type: note
status: active
tags: [poe2, sniper, future-ideas]
created: 2026-06-12
updated: 2026-06-12
---

# poe-trade-sniper — Future ideas (parking lot)

Post-MVP ideas land here instead of creeping into phase scope. Promotion to a
phase requires an explicit decision in [40_decisions](40_decisions.md).

- **Analytics dashboard** — built from the `hits` table: what I bought, what I
  missed, price distributions per search.
- **Per-search sound profiles** — distinct alert sounds so the search is
  recognizable without looking.
- **Multi-account support** — second PoE account / second league session.
- **Price-trend filters** — "alert only if below N-day median".
- **"Buy budget" guard** — stop auto-travel after spending X per session.
- **Shareable search presets** — export/import search definitions.
- **Headless cron mode** — run detection without any UI, notify externally.
- **Phone notifications** — push hit alerts to mobile.
- **Cross-machine sync** of searches/history (parked O-4 — reopens cloud/Atlas question).
- **Electron IPC transport** for UI↔core (optimization over loopback HTTP, see O-2).
- **Code signing / notarization** of desktop builds (Win + macOS).

## Queued for next (agreed 2026-06-12, do after the Network view)

1. **In-app updates** — detect a newer version we publish and offer a button
   ("new version available") or auto-update. Design the release/update channel
   (electron-updater + a release feed, or a lightweight version check + manual
   download). Needs a place to host releases.
2. **Live-hits travel UX** — on a _failed_ travel, show a manual **retry**
   button; and show **relative time** ("3m ago", recalculated live) next to the
   absolute detection time. (Relative-time helper already exists:
   `apps/web/src/lib/relative-time.ts`.)
3. **Hits view item detail refactor** — rework the item-parameter rendering in
   the whole Hits view to match the search-criteria card layout
   (`QueryCriteriaView` / `lib/query-criteria.ts`) for visual consistency.
