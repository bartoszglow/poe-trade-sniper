import type { ManagedSearch } from './search.js';

/** Bump when the search-export envelope shape changes incompatibly. */
export const SEARCH_EXPORT_VERSION = 2;

/**
 * A room as exported: `id` only correlates memberships WITHIN the file; on
 * import rooms are matched to existing ones by NAME (else created fresh), so
 * ids never collide across machines.
 */
export interface ExportedRoom {
  id: string;
  name: string;
  collapsed: boolean;
}

/**
 * Round-trippable export of the configured searches. Searches hold NO credentials
 * (the session lives encrypted in app_state, never here), so the whole envelope is safe
 * to write to disk and share. Logs (hits / activity) are CSV export-only, not in here.
 * v2 adds `rooms` + `roomId` memberships; v1 files still import (everything top-level).
 */
export interface SearchExportEnvelope {
  kind: 'poe-sniper-searches';
  version: number;
  exportedAt: string;
  searches: ManagedSearch[];
  /** Absent in v1 exports. */
  rooms?: ExportedRoom[];
}

/** On id conflict during import: keep the existing search, or remove + re-insert it. */
export type ImportConflictMode = 'skip' | 'replace';

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}
