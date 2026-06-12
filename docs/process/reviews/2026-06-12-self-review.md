# Self-review — 2026-06-12 (Phases 0–4 + desktop preliminary)

Full pass over everything written so far, security-first. Findings split into
fixed-in-this-pass and accepted/parked.

## Fixed during this review

| #   | Severity | Finding                                                                                                                                      | Fix                                                                                                                                                            |
| --- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **HIGH** | Server listened on ALL interfaces — session paste, travel and search control reachable from the LAN.                                         | `HOST` config, default `127.0.0.1`; `listen(port, host)`.                                                                                                      |
| 2   | **HIGH** | DNS rebinding: a malicious site pointing its hostname at 127.0.0.1 could drive the API from a victim's browser (non-preflighted requests).   | `HostGuardMiddleware` — only `localhost`/`127.0.0.1`/`[::1]` Hosts served (403 otherwise).                                                                     |
| 3   | **HIGH** | e2e suite with `reuseExistingServer` ran against the live dev server and its session-lifecycle test **deleted the operator's real session**. | Dedicated e2e port 3590, `reuseExistingServer: false`.                                                                                                         |
| 4   | MED      | Session stored plaintext in SQLite (D-7 debt).                                                                                               | AES-256-GCM at rest, key in macOS Keychain (`SessionCipher`); legacy rows readable, re-encrypted on save; plaintext fallback (loud warning) where no keychain. |
| 5   | MED      | Electron renderer ran with default webPreferences and unrestricted navigation.                                                               | Explicit `contextIsolation`/`sandbox`/`nodeIntegration:false`, `setWindowOpenHandler` deny, `will-navigate` pinned to the app origin.                          |
| 6   | MED      | ws reconnect ladder reset after every successful open → connect/instant-drop loops hammered GGG at 1 s (ban risk, observed live).            | Reset only after ≥60 s stable connection; 1013 jumps to max backoff; demotion to poll after 3 unstable cycles; OutboundGuard ceilings as the backstop.         |
| 7   | LOW      | Guard reset kept old rolling-window timestamps — instantly re-tripped.                                                                       | Reset clears the windows (caught by its own unit test).                                                                                                        |

## Accepted / parked (with rationale)

- **API has no authentication** — accepted: loopback-bound + Host-guarded,
  single-operator tool; revisit only if remote access ever becomes a feature.
- **CDP debug port open during login capture** — any _local_ process could
  attach to that Chrome for up to 5 min. Accepted: dedicated empty profile,
  short window, local machine; the captured session is the same secret the
  attacker-local could read from our DB anyway (keychain mitigates).
- **Cookie-header building duplicated** (SessionService + ws-engine
  socketHeaders) — 3 lines, two call sites; extract on the third use.
- **search-manager.ts ~470 lines** — nearing the god-file threshold; seams
  exist (hits repository, scheduler). Split when Phase 6 analytics touches it.
- **`FALLBACK_USER_AGENT` pins a Chrome version string** — config-overridable;
  goes stale harmlessly (only used for paste-without-UA).
- **Prototype's `session-state.json` is plaintext on disk** (outside this
  repo) — recommend deleting it now that the session is imported + encrypted;
  the import CLI stays useful for re-exports.

## Verified clean

- No cookie/session values in any log statement or API response (grep +
  tests assert it); correlation ids thread all GGG calls.
- All outbound GGG traffic flows through `TradeApiClient` → governor + guard;
  no stray `fetch` to pathofexile.com elsewhere (ws handshakes gated too).
- Travel: explicit opt-in validated securable; tokens never persisted; queue
  serialized; stale tokens dropped.
- Zod at every API edge; TypeScript strict; explicit `@Inject` everywhere
  (D-11); every timer/socket/subscription torn down on shutdown (checked
  module by module).
- Secrets hygiene: `.env*`, `session.json`, `data/` gitignored; gitleaks on
  pre-push; no real account data in fixtures.
