import type { ManagedSearch } from './search.js';

/** Bump when the search-export envelope shape changes incompatibly. */
export const SEARCH_EXPORT_VERSION = 1;

/**
 * Round-trippable export of the configured searches. Searches hold NO credentials
 * (the session lives encrypted in app_state, never here), so the whole envelope is safe
 * to write to disk and share. Logs (hits / activity) are CSV export-only, not in here.
 */
export interface SearchExportEnvelope {
  kind: 'poe-sniper-searches';
  version: number;
  exportedAt: string;
  searches: ManagedSearch[];
}

/** On id conflict during import: keep the existing search, or remove + re-insert it. */
export type ImportConflictMode = 'skip' | 'replace';

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}
