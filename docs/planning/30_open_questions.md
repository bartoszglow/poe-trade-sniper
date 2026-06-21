---
type: log
status: active
tags: [poe2, sniper, open-questions]
created: 2026-06-12
updated: 2026-06-12
---

# poe-trade-sniper — Open questions

Register of unresolved decisions. When resolved → strike through here, record in
[40_decisions](40_decisions.md).

| ID      | Question                                                                                                                                                                                                                                          | Decide at                  | Status                                                                                        |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------- |
| ~~O-1~~ | Encrypt session at rest from Phase 1 or plain file until Phase 4?                                                                                                                                                                                 | Phase 0                    | **Resolved → D-7** (plain file + `0600` until Phase 4, `SessionStore` interface from Phase 1) |
| O-2     | Desktop UI↔core transport: loopback HTTP (simplest, reuses web client verbatim) vs Electron IPC (faster, more wiring)?                                                                                                                            | Phase 5                    | Open                                                                                          |
| ~~O-3~~ | SQLite driver: `better-sqlite3` vs `libsql`?                                                                                                                                                                                                      | Phase 0                    | **Resolved → D-6** (better-sqlite3)                                                           |
| O-4     | Cross-machine sync of searches/history (reopens the cloud question)?                                                                                                                                                                              | —                          | Parked → [90_future_ideas](90_future_ideas.md)                                                |
| O-5     | Exact `status.option` API values for the 4 unverified purchase types (Instant+InPerson / Online in League / Online / Any) + the league-list endpoint — capture via resolve once session validates (repo `docs/integration/api-notes.md` ma plan). | Phase 1, po imporcie sesji | Open                                                                                          |
