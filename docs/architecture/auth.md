# Authentication strategy

## Why not "Log in with Path of Exile" (OAuth redirect)

GGG's official OAuth 2.0 ("redirect to poe website" login used by some
community apps) is **not usable for this tool**, for two independent reasons:

1. **Manual gatekeeping** — OAuth client credentials require emailing GGG and
   per-app approval (oauth@grindinggear.com). No self-service registration.
2. **Decisive:** the official OAuth API **does not cover the trade endpoints**.
   `/api/trade2/*` (search, fetch, live ws, whisper/travel) authenticates with
   the browser session cookie (`POESESSID` + Cloudflare), not OAuth tokens. An
   approved OAuth app still could not run a sniper.

Community trade tools (Awakened PoE Trade et al.) work the same way: they ride
the browser session, not OAuth.

## Supported session sources (the `SessionSource` seam)

The session is always the same thing — a cookie set + matching User-Agent.
What differs is how the user hands it to us. **The Settings UI commits to
offering BOTH interactive paths** (decided with Bartosz 2026-06-12): a
"Log in with Path of Exile" button (in-app login on the real GGG page —
BrowserWindow on desktop, assisted system-browser capture on web) **and** the
manual cookie-paste form for users who won't type credentials anywhere near a
third-party app. Neither is a fallback for the other.

| Source                                                                          | Mode          | Trust story                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Manual cookie paste** (`POST /api/session/cookies`, Settings form in Phase 3) | web + desktop | User copies `POESESSID` (+ `cf_clearance` if needed) from their own browser's devtools. **Credentials never touch the app.** For users who won't type a password anywhere near us.                                                |
| **Prototype JSON import** (`pnpm session:import`)                               | dev           | One-off bootstrap from `poe2-live-sniper`'s `session-state.json`.                                                                                                                                                                 |
| **Electron `BrowserWindow` login** (Phase 5)                                    | desktop       | The window renders the REAL pathofexile.com login page; credentials go only to GGG, we read cookies from the window session afterwards. Same trust model as "login via redirect" in other apps — the app never sees the password. |
| **System-browser capture** (Phase 4)                                            | web           | Assisted capture without Electron.                                                                                                                                                                                                |

## Rules

- The session is a credential: never logged, never returned by the API
  (`/api/session/status` exposes only `{loggedIn, capturedAt, cookieNames}` —
  names, never values), stored via `SessionStore` (plain file/DB until
  Phase 4 — D-7).
- Login signal is a `/my-account` 200 probe, never cookie presence (guests get
  a `POESESSID` too).
- `TODO(verify)`: whether `POESESSID` alone satisfies the API endpoints or
  `cf_clearance` + exact UA match is required when Cloudflare challenges —
  affects how much the paste form must ask for. Evidence so far (2026-06-11):
  prototype always sent the full set.
