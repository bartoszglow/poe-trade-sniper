# 27 — Database export / import

**Decision (approved 2026-06-25):** operator-facing **export + import** of the local DB.

- **searches** (config): **JSON round-trip** (export + import). The query `filters` are
  nested, so JSON is lossless and needs no dependency. The "inny popularny format".
- **hits** + **activity** (logs): **CSV export only** (flat, opens in Excel = the "xls"
  need). Importing a historical log is meaningless.
- **`.xlsx`**: **deferred** — CSV already opens in Excel; real `.xlsx` would add a heavier
  lib (`exceljs` write-only ok; `sheetjs` parser has security history). Revisit only if
  multi-sheet/formatted workbooks are wanted.
- **Import conflict policy:** default **skip-existing** (by `id`); optional `mode=replace`.

## Hard constraints

- **Credentials never leave** (hard rule #3). Export reads only `searches` / `hits` /
  `activity` — all credential-free. The `app_state` table (encrypted session + settings)
  is NEVER exported/imported. Hideout tokens are never persisted. Add a test that asserts
  the export output contains no session/cookie/token material.
- Network-log records **metadata only** (operation + count + outcome), never the payload.

## Key design note

A `searches` row stores the **resolved `filters`**, not the raw input string — so import
**restores the row directly** (insert + re-create the watcher from stored filters); it does
**not** re-run `tradeApi.resolveQuery()` (no input kept, would need a live session). A stale
filter just won't match; acceptable. Fully offline — no session required.

## Architecture

- **shared:** `SearchExportEnvelope { version, exportedAt, searches: SearchExportEntry[] }`
  (+ `SEARCH_EXPORT_VERSION`). Types only; the import Zod schema lives server-side.
- **server** `src/export-import/`:
  - `ExportController` — `GET /api/export/searches` (JSON attachment),
    `/api/export/hits`, `/api/export/activity` (CSV attachments). `@Res()` +
    `Content-Disposition` (no file-download precedent yet).
  - `ImportController` — `POST /api/import/searches` (JSON body, Zod-validated) →
    `{ imported, skipped, errors }`.
  - `ExportService` (serialize: JSON searches; CSV hits/activity via `csv-stringify`),
    `ImportService` (validate → `SearchManager.importSearches`).
  - `SearchManager.exportSearches()` + `importSearches(entries, mode)` (insert row +
    create/start watcher; restore filters as-is; skip/replace on id conflict).
- **web:** a "Backup / data" `SettingsCard` — export buttons (`downloadFile` helper) +
  "Import searches" file picker (read+parse → POST) using the existing `run()`/message
  pattern. EN/PL i18n. Operator view → mockup-first exempt.

## Build phases

1. shared envelope type + version.
2. server: `SearchManager` export/import; `ExportService`/`ImportService`; controllers;
   module; register; add `csv-stringify` dep.
3. web: Settings card + `downloadFile`/`readJsonFile` helpers + i18n.
4. tests: export JSON/CSV shape; import validate/skip/replace; round-trip equality;
   credential-exclusion assertion.
5. this doc + commit.

## Status

- 2026-06-25: planned + approved. Implementation starting.
