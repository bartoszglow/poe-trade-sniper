# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
