# Review — Travel/Buy actions in the Hits view (plan 45)

- **Date:** 2026-07-11
- **Scope:** uncommitted working-tree changes on `main` (plan 45). NOT a full-codebase pass.
- **Verdict:** **PASS** — no confirmed S1; no un-deferred S2. Automated gate `pnpm verify` green (lint + typecheck + 441 server/desktop unit tests).
- **Reviewers:** security, correctness, architecture, consistency, testing, frontend, reliability → all findings routed through `review-verifier` (adversarial). REL-2 refuted; 5 severities corrected down.

## Change set

Modified: `apps/server/src/buy-automation/buy.controller.ts` (new `POST /api/buy/retry`),
`apps/web/src/components/HitCard.tsx`, `apps/web/src/pages/HitsPage.tsx`,
`apps/web/src/shell/HitsPanel.tsx`, `apps/web/src/i18n/messages.ts`.
New: `apps/web/src/components/HitActions.tsx`, `apps/web/src/hooks/useHitActions.ts`,
`apps/web/src/lib/hit-actions.ts` (+ `.test.ts`),
`apps/server/src/buy-automation/buy.controller.test.ts`, `docs/planning/45_hits_view_actions.md`.

## Summary table

| ID               | Sev | Area         | File                                                 | One-line                                                                                                                |
| ---------------- | --- | ------------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| REL-1            | S3  | reliability  | travel.service.ts:129 / buy.controller.ts:93         | Manual re-resolve path has no headroom pre-check / single-flight (auto path does) → SEARCH-budget drain                 |
| CORR-1           | S3  | correctness  | buy.controller.ts:93 / buy-automation.service.ts:154 | Gone-offer Buy leaves a listingId-keyed intent that can fire on a later Travel-only click on the same hit               |
| FEEDBACK         | S3  | reliability  | useHitActions.ts:34,51,63,72                         | `.catch(()=>{})` swallows 403/500/network → silent no-op indistinguishable from success                                 |
| SRV-500          | S3  | reliability  | search-manager.ts:931                                | `refreshListing` tier-2 unguarded: a throw → controller 500 with **no** SSE travel event (spent budget, no feedback)    |
| TEST-1           | S3  | testing      | useHitActions.ts                                     | No client contract test for travelRetry/buyRetry (path + `{searchId,listingId,offerKey}` body)                          |
| TEST-2           | S3  | testing      | HitActions.tsx:115,127                               | Fresh-vs-retry click routing + split busy-states untested (the new plan-45 behavior)                                    |
| TEST-3           | S3  | testing      | travel.service.ts:129                                | `retryTravel` has zero tests; the original-listingId event re-tag (load-bearing for buy-on-arrival + CORR-1) unverified |
| STATUS-DROP      | S4  | correctness  | HitsPage.tsx:261,273 vs HitCard.tsx:127              | Status cluster gated on `actionable`; a mid-flight action aging past 60 min drops feedback (HitCard is unconditional)   |
| FE-RESPONSIVE    | S4  | frontend     | HitsPage.tsx:239                                     | Expand button lacks `min-w-0` → cluster overflow on narrow screens                                                      |
| A11Y-LIVE        | S4  | frontend     | HitActions.tsx:86 / :24                              | Status spans lack `aria-live`/`role=status`                                                                             |
| ICON-A11Y        | S4  | frontend     | HitActions.tsx:104,117,129                           | Decorative lucide icons lack `aria-hidden`                                                                              |
| ARCH-VALIDATION  | S4  | architecture | buy.controller.ts:81                                 | Hand-rolls safeParse+BadRequest; `parseOrBadRequest` primitive exists (now 4 hand-rolled sites)                         |
| CANCONTROL-RADAR | S4  | architecture | HitsPanel/HitsPage/SearchesPage                      | `canControl ?? false` derived at 3 sites → `useServerStatus`-derived field                                              |
| CORR-OFFERKEY    | S4  | correctness  | offer.ts (itemSignature)                             | A persisted `item:null` hit's offerKey can't match a live parsed offer → false "no longer listed"                       |
| REL-SUSPEND      | S4  | reliability  | travel.service.ts:111                                | During a buy-lock, `retryTravel` spends budget, enqueues nothing, returns `{found:true}` (false success)                |
| CON-CHANGELOG    | S4  | consistency  | CHANGELOG.md                                         | No `[Unreleased]` entry for a user-facing feature (pre-commit must-do)                                                  |
| CON-ORPHAN       | S4  | consistency  | messages.ts:355,1015                                 | `hitCard.tokenExpired` i18n key now orphaned                                                                            |
| CON-PLANDOC      | S4  | consistency  | docs/planning/45:41                                  | Plan lists a `buyState` prop; impl split it into `HitBuyStatus`                                                         |
| TEST-4           | S4  | testing      | useHitActions.ts:25,42                               | `searches.find`+token guard untested (live only via HitCard; dead from HitsPage)                                        |
| TEST-NAN         | S4  | testing      | hit-actions.test.ts                                  | NaN/invalid `detectedAt` case unpinned (accidentally correct: hidden)                                                   |

## Verified-safe (aggregated CLEAN)

- **Server gate re-check, no bypass:** `buyRetry` parses (Zod) → `canControl()` → `ForbiddenException` before any service; `maybeBuy` re-checks `canControl` at consume time; adapters re-check at the resource boundary (decision #3). Order pinned by test.
- **No token/secret leakage:** retry endpoints return only `{found:boolean}`; the re-resolved token flows only into server-side `enqueue`, never into the response or the published travel event; retry body carries no token (hard rule #3). Host-guard + Origin/CSRF check (SEC-1) covers the new POST routes.
- **Hard rule #4:** all new GGG traffic stays inside `retryTravel`→`refreshListing`→`tradeApi`→governor; no stray `fetch`. Client goes through `apiSend`.
- **Hard rule #5:** manual Buy/Travel are explicit clicks (`source:'manual'`), never defaulted auto-travel.
- **Mark-before-travel keys match end-to-end:** original `listingId` threads mark → enqueue → success event → consume. `isHitActionable` boundary inclusive at 60 min, clock-skew + NaN safe. `HIT_ACTION_MAX_AGE_MS` centralized (no magic number). 30s interval cleaned up on unmount; no new SSE subscription; `forceBuyListingIds` bounded (cap 50 FIFO). No button-in-button (sibling cluster verified in HitsPage + HitCard). `Hit extends Listing` — offerKey/useHitActions substitutability sound, no cast/drift. Atomic `<Button variant>` reuse, theme tokens, no inline styles. i18n: `hitCard.buyRetryTitle` present EN+PL. react-refresh clean (no eslint-disable). buy.controller.test asserts real intent (invocationCallOrder, forbidden/malformed paths).

## Scope not reached

- No browser/runtime verification (mobile overflow, focus order, SR announcement reasoned from code, not observed) — `review-browser` not run (no explicit request).
- GGG `tradeApi` internals, the CV/vision buy pipeline past `maybeBuy`, and the governor implementation were read for context but not audited (unchanged by this diff).
- No Playwright e2e exists for `/api/buy/retry` or `/api/travel/retry`.

## Refuted

- **REL-2** (intent mis-fire on a _recycled_ listingId hitting an unrelated offer): `offer.ts` documents result-hash ids as one-offer→many-ids (content-addressed per serve); the claimed direction needs a hash collision. The genuine residual is CORR-1 (same hit), already captured.

## Accepted / deferred

None deferred — no S2+. All S3/S4 are fix-in-PR-or-track; owner **Bartosz** decides fix vs track per item. CON-CHANGELOG is a pre-commit must-do (no commit exists yet).
