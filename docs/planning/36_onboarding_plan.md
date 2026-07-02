# 36 — First-run onboarding (welcome wizard + getting-started checklist)

**Status: IMPLEMENTED** — `c4311c5`, 2026-07-02 (mockup `docs/mockups/onboarding.html`
approved beforehand). Verify green (web 47, server 209, desktop 6). Wizard
(`apps/web/src/shell/OnboardingWizard.tsx`, step registry, `lg`-breakpoint content,
embedded real login with auto-advance) + `GettingStartedCard` on Searches (derived from
live state, `lib/getting-started.ts` unit-tested) + "Show intro" in About & Settings.
Flags: `sniper.onboardingDone`, `sniper.gettingStartedDismissed` (localStorage,
change-event synced).

Grounded in a 7-area app audit + first-run critic (workflow, 2026-07-02): there is no
onboarding today; the de-facto first run is the dismissible `LoginOverlay`, and session
acquisition is the #1 stuck-point. The three concepts the wizard MUST teach: (1) the app
rides your PoE session — nothing works without it; (2) searches are authored on the
official trade site and pasted here; (3) hits are perishable (~4 min token) and Travel
moves the real character (opt-in, Instant Buyout only).

## Decisions (approved)

- **D-onb-1 — the login step is SKIPPABLE** with a clear "the app stays inactive until you
  log in" warning. The Searches login gate catches whoever skips. No hard block.
- **D-onb-2 — the "Getting started" checklist IS in scope (phase 2)**: a dismissible card
  on the Searches view tracking the real funnel — logged in ✓ → first search added ✓ →
  first hit received ✓. Derived from existing state (session status, searches count,
  hitCount>0); dismissal persisted per-device.
- **D-onb-3 — the first-search step is a HOW-TO, not a slide** (operator request): it must
  explain that the whole search is BUILT on the PoE2 trade site, show HOW to copy the
  URL/id from that page (address bar or the search slug), and explicitly call out ticking
  **Instant Buyout ("Zakup natychmiastowy") in the trade-site filters** — only securable
  listings carry a hideout token, so TRAVEL requires it (the server rejects auto-travel
  otherwise).

## Shape: a 4-step responsive wizard that ABSORBS the LoginOverlay

One component, no competing overlays; spotlight tours rejected (first-run anchors don't
exist: Searches is login-gated, the hits panel is empty and absent below `lg`, tooltips
don't exist on touch).

1. **Welcome** — what the app is (two sentences, README pitch) + GGG fan-tool disclaimer.
2. **Login (load-bearing)** — why it's REQUIRED; expectation-setting for the external
   Chrome window ("log in there, it closes itself"); the cookie-paste alternative (the
   remote/mobile path — the Chrome window opens on the SERVER machine); privacy story
   (password never touches the app; cookie encrypted locally). Embeds the REAL login
   button (`useLoginCapture`), auto-advances on success. Skippable per D-onb-1.
3. **Your first search (how-to, D-onb-3)** — numbered steps with a mini-visual:
   build on pathofexile.com/trade2 → tick Instant Buyout in filters → copy the URL (or
   the id from it) → paste into the app. One-liners for ACTIVE / TRAVEL / BUY with the
   travel warning verbatim.
4. **Where things happen** — desktop: live hits panel (act within ~4 min, resize/hide);
   mobile variant (below `lg`): honest note that live actions need a desktop-width
   window; Hits/Activity = history. Finish lands on Searches with the add form open.

## Mechanics

- `sniper.onboardingDone` in localStorage (per-device, `sniper.*` convention); wizard
  replaces the bare LoginOverlay while unset. "Show intro" re-launch in About & Settings.
- Steps as a registry array (open/closed — a step = an entry). Copy EN + PL from day one.
- Breakpoint-gated content via the actual `lg` media query, not user-agent sniffing.

## Phases

1. Mockups (desktop + mobile, this doc's gate) → approval.
2. Wizard implementation (shell integration, LoginOverlay absorption, i18n, flag).
3. Checklist card (D-onb-2) + "Show intro" entry points.

## Parked product gaps (→ future_ideas if wanted)

Chrome-binary preflight before offering assisted login; in-app Cloudflare/cf_clearance
diagnosis; starter-search gallery; a mobile live-hits surface.
