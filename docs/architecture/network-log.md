# Network log (developer view + shareable file)

A single, redacted record of every interaction with GGG trade — for debugging
during development, and for an end user to share a log file when something
misbehaves.

## One sink, fed from the two choke points

Every GGG HTTP call already funnels through `TradeApiClient.request()`, and
every live socket through `WsEngine`. Both call **`NetworkLog.record()`** — the
only sink. Nothing else logs traffic, so there is no scattered logging to keep
in sync.

`record()` fans one entry out three ways:

1. **Ring buffer** (`NETWORK_LOG_RING_SIZE`, default 500) — the dev view's
   initial load via `GET /api/network` (returns the ring + the log file path).
2. **Live `network` event** on the RealtimeBus → SSE → the view updates live.
3. **Rotating JSONL file** at `LOG_DIR/network.log.jsonl` (one rotated
   generation `*.1` past `LOG_MAX_BYTES`). Desktop points `LOG_DIR` at the OS
   logs dir; dev uses `./data/logs`. The file is **always written**, even when
   the view is hidden, so it can be attached to a bug report.

## Redaction is structural

`NetworkLogEntry` has **no field for a cookie, User-Agent or hideout token** —
the callers only ever pass the safe URL (our GGG URLs carry just search / league
/ listing ids), HTTP status, timing, outcome, and the `x-rate-limit-*` response
headers. The whisper body (which holds a hideout token) is never logged; only
`POST /api/trade2/whisper` and its status are. So a shared log cannot leak the
session or a teleport token.

## What an entry captures

`channel` (http/ws), `method`, `url`, `policy` (rate-limit bucket), HTTP
`status` or ws close code, `durationMs`, an `outcome` bucket (`ok` /
`client-error` / `server-error` / `rate-limited` / `guard-blocked` /
`no-session` / `timeout` / `network-error`, plus `ws-connecting` / `ws-open` /
`ws-closed` / `ws-frame`), a redacted `detail`, and the rate-limit headers.

## The view

`/network`, an icon-rail entry gated by a Settings toggle (default on for dev;
hide it for an operator build — the file keeps recording). Live table with
relative timestamps, channel/method/endpoint/policy/status/duration/outcome,
row-expand detail (full URL, correlation id, rate-limit headers), text +
channel + errors-only filters, and pause/clear. The log file path is shown with
a copy button for sharing.
