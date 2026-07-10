# 44 — Unified search phase model (spec/status separation)

**Status:** CONFIRMED by operator 2026-07-10 (option B + `halted`); implementation
same day. Supersedes the status semantics of plan 43 (its machinery — sticky
episodes, flap detector, stability window, recovery ladder — is retained as the
`degraded` phase's internals).

## Why

The operator kept hitting toggle↔status contradictions (room bug, degraded+gold
toggle). Root cause: `EngineStatus` mixes three orthogonal things — intent
(stopped/paused), health (degraded), and lifecycle (pending/connecting/active) —
and the UI toggle shows intent while LOOKING like it shows health.

Research anchors (recorded in chat 2026-07-10): Kubernetes spec/status +
reconciler (intent is written ONLY by the user, observed state ONLY by the
system); statecharts (gates are transition guards, not state mutations); toggle
UX research (users read a switch as CURRENT state → its visual must not claim
health it doesn't have); Sidekiq job lifecycle (failed is transitive; a Dead
state after retries exhaust, revived manually).

## The model

**Intent (spec)** — user-writable only, never touched by the system:
`search.enabled`, `room.enabled`, global detection switch. (Already true since
D-room-1 v2.)

**Phase (status)** — system-writable only, ONE derivation point:

| Phase      | Meaning                                                                                             | Enter                                                                   | Exit                                                           |
| ---------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| `starting` | spinning up (pending/connecting)                                                                    | intent ON + gates open                                                  | connected → `running`                                          |
| `running`  | detecting (ws/poll chip)                                                                            | from `starting`                                                         | failure → `degraded`; gate closes → `held`; user OFF → `held`  |
| `held`     | INTENTIONALLY not running; reason `user`/`room`/`global`/`archived`                                 | any gate closes                                                         | gate opens → `starting`                                        |
| `degraded` | failure; system healing (reason + since; ladder 5/10/30 min; 5-min stable window clears)            | 1013 / 3 drops per 10 min / guard / no-session / transient poll trouble | stable → `running`; gate → `held`; ladder exhausted → `halted` |
| `halted`   | **NEW** — system gave up after `DEGRADED_MAX_RECOVERY_ATTEMPTS` (default 6); waits for the operator | from `degraded`                                                         | manual Restart only → `starting`                               |

**Invariants**

1. The system NEVER writes intent (the room-bug lesson).
2. `held` outranks `degraded`/`halted`: closing any gate interrupts healing →
   `held`; reopening resumes at `starting` with the health history kept.
3. `degraded`/`halted` are only reachable with intent ON + gates open.
4. Phase is runtime-only; an app restart is a fresh start (unchanged).
5. One derivation point: every transition flows through the phase setter, which
   owns sticky suppression + priority (closes review ARCH-2/COR-1).

**Toggle semantics (option B — operator-confirmed).** Toggle POSITION = intent
(only the user moves it); toggle VISUAL = truth: gold only when `running`;
amber/dimmed when ON but not running (`starting`/`degraded`/`halted`/gate-held),
with the reason beside it; grey when OFF. The switch never silently flips —
option A (position follows state) was rejected: it makes the control ambiguous
under gates and re-creates the lossy-intent bug.

**Surfacing** — phase badge + reason on the row ("degraded for 23m"); room
header chip counts `degraded`+`halted` members; AppBar beacon counts sticky
`degraded` (via `degradedSince`) + `halted` — NOT transient blips (review
BEACON); `halted` is the loudest (danger) with Restart as the row-level cue.

## Mapping from current EngineStatus

pending/connecting → `starting` (sub-detail kept) · active → `running` ·
stopped(user/archived) → `held(user|archived)` · paused(global/room) →
`held(global|room)` · degraded → `degraded` (plan-43 internals unchanged) ·
(new) → `halted`.

Implementation mapping (D-ph-3 refined): the phase machine is realized ON the
existing `EngineStatus` value set (`active`≡running, `pending|connecting`≡
starting, `stopped|paused`≡held with the reason in detail/derivable gates,
`degraded`≡degraded) plus the NEW `halted` value — a wholesale vocabulary
rename would be ~1.5k lines of mechanical churn with zero behavior change
(UI labels are i18n anyway); parked as an optional later pass. What IS
enforced now: the single phase setter, priorities, `halted`, and the
option-B toggle visuals.

Halted revival rules: ONLY explicit per-search acts revive a `halted` watcher —
the Restart button or the operator flipping ITS OWN toggle off→on (an explicit
intervention on that search). Bulk gate reopenings (room/global) do NOT — the
drip excludes `halted` exactly like `stopped`.

## Absorbed review findings (2026-07-10 full review)

SEC-1 fixed separately (host-guard Origin check). This plan absorbs: BEACON
(beacon keys off stickiness, not raw status), FE-2 (Restart in-flight guard),
ARCH-2+COR-1 (single phase setter), TEST-1/4/5/7 (blind-family skip, ladder
config, transient-error lingering, degradedFor formatting).

## Config

`DEGRADED_MAX_RECOVERY_ATTEMPTS` (default 6 ≈ 5+10+30×4 ≈ 2.2 h of healing
before `halted`). Existing plan-43 knobs unchanged.

## Decisions

- **D-ph-1 (operator, 2026-07-10)** — spec/status separation with option-B
  toggle (position=intent, visual=truth) + the `halted` terminal phase.
- **D-ph-2** — `held` priority over health phases; healing history survives a
  gate round-trip.
- **D-ph-3** — phase replaces EngineStatus wholesale (no dual field); runtime-only.
