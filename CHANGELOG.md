# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Phase 3 web UI: live SSE event stream into the shell (one `EventSource`,
  capped live-hits feed, per-listing travel states); Searches page (add by
  id/URL, purchase-type + AUTO inline edits, live engine/status badges);
  persistent live-hits panel with token-gated Travel button; Hits history
  with item-detail accordion; Settings (session card with live probe via new
  `POST /api/session/probe`, cookie-paste form, in-app login placeholder per
  D-12, rate-limit budgets); status bar shows session/budget/travel queue.
- Phase 2 travel: browser-free hideout travel (`/api/trade2/whisper` with the
  X-Requested-With header discipline) under a dedicated whisper rate-limit
  policy; `TravelService` FIFO queue (one travel at a time, stale tokens
  dropped); auto-travel as a hit-event consumer (per-search opt-in); manual
  `POST /api/travel`; `travel` lifecycle events on SSE and travel section in
  `/api/status`.
- Phase 1 detection core: trade-api adapter (single GGG gateway), rate-limit
  governor driven by live `X-Rate-Limit-*` headers, ws/poll engine registry
  with tarpit-guarded probe and automatic poll→ws upgrade, SearchManager with
  shared round-robin scheduler and hit persistence, session module (manual
  cookie paste + prototype import behind `SessionStore`), per-search purchase
  mode (Instant Buyout verified, rest `TODO(verify)`), RealtimeBus → SSE
  stream, REST API (`/api/searches`, `/api/hits`, `/api/status`,
  `/api/session/*`, `/api/events`).
- Phase 0 foundation: pnpm monorepo, strict TypeScript, ESLint/Prettier, Husky
  hooks (lint-staged, audit, gitleaks), CI.
