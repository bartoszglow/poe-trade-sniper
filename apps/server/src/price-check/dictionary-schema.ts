/**
 * The trade dictionary (#37) — the comprehensive, versioned, diffable snapshot
 * of GGG's trade data we build the price checker on. Designed to grow: every
 * dataset GGG exposes (stats, item bases, uniques, currency/static, filters)
 * has a home here with room for the properties/tiers a Tier-2 game-file
 * pipeline will add later, WITHOUT reshaping what's already stored.
 *
 * Design goals (operator request):
 *  - COMPREHENSIVE — one structure holds every dataset, each entry keeps its
 *    source metadata (domain/type/category/flags) so richer matching can be
 *    added without a re-fetch.
 *  - VERSIONED — `schemaVersion` (our shape) + `dataVersion` (GGG's, e.g. a
 *    league/patch tag) let us detect "rebuild needed" precisely; bumping
 *    SCHEMA_VERSION forces every user to rebuild on next launch.
 *  - COMPARABLE — a pure `diffDictionary` reports exactly what a league added,
 *    removed or changed, so an update is auditable, not a black-box overwrite.
 *  - UPDATABLE — entries are keyed (stat id, item key) so a refresh is a keyed
 *    merge, not a positional one; partial datasets never clobber the rest.
 */

/** Bump when the STRUCTURE below changes — forces a rebuild for every user. */
export const DICTIONARY_SCHEMA_VERSION = 1;

/** A searchable stat from `/data/stats`, plus room for future roll metadata. */
export interface StatDef {
  /** Namespaced trade id, e.g. `explicit.stat_1050105434`. Primary key. */
  id: string;
  /** Display template with `#` roll placeholders, e.g. `+# to maximum Life`. */
  text: string;
  /** Domain: explicit / implicit / enchant / rune / fractured / pseudo / … */
  type: string;
  /** Number of `#` placeholders — 0 for a flag stat. */
  placeholders: number;
  /** Enum-style stats carry selectable options ({id, text}); empty otherwise. */
  options: Array<{ value: string; text: string }>;
  /** Tier-2 (game files, later): per-tier roll ranges. Absent until built. */
  tiers?: Array<{ tier: number; min: number; max: number }>;
}

/** A base type / unique / gem from `/data/items`. */
export interface ItemDef {
  /** Lowercased `type` (base) or `name` (unique) — the lookup key. */
  key: string;
  /** Canonical display name (unique name, or base type). */
  name: string;
  /** Base type when the entry is a named item (unique/gem), else = name. */
  baseType: string | null;
  /** Trade item category (e.g. `armour.chest`) when GGG groups it. */
  category: string | null;
  flags: {
    unique: boolean;
    gem: boolean;
  };
  /** Tier-2 (later): base properties (armour/evasion/ES, weapon dmg/aps/crit). */
  properties?: Record<string, number>;
}

/** A currency/static entry from `/data/static` (exchange + fixed items). */
export interface StaticDef {
  id: string;
  text: string;
  category: string | null;
}

/** Provenance + counts, so a stored dictionary is self-describing / auditable. */
export interface DictionaryMeta {
  schemaVersion: number;
  /** GGG data version — league/patch tag when known, else the fetch date. */
  dataVersion: string;
  realm: string;
  league: string;
  fetchedAt: string;
  /** Per-dataset entry counts — a cheap integrity / drift check. */
  counts: { stats: number; items: number; statics: number };
}

/** The whole comprehensive snapshot — cached in app_state, diffed on refresh. */
export interface TradeDictionary {
  meta: DictionaryMeta;
  stats: StatDef[];
  items: ItemDef[];
  statics: StaticDef[];
}

/** A keyed change set for one dataset. */
export interface DatasetDiff<T> {
  added: T[];
  removed: T[];
  /** Entries present in both whose serialized form changed. */
  changed: Array<{ before: T; after: T }>;
}

export interface DictionaryDiff {
  /** True when the schema version differs — a full rebuild, not a merge. */
  schemaChanged: boolean;
  dataVersionChanged: boolean;
  stats: DatasetDiff<StatDef>;
  items: DatasetDiff<ItemDef>;
  statics: DatasetDiff<StaticDef>;
  /** True when nothing at all changed (safe to keep the cache untouched). */
  identical: boolean;
}

function diffDataset<T>(before: T[], after: T[], keyOf: (entry: T) => string): DatasetDiff<T> {
  const beforeByKey = new Map(before.map((entry) => [keyOf(entry), entry]));
  const afterByKey = new Map(after.map((entry) => [keyOf(entry), entry]));
  const added: T[] = [];
  const removed: T[] = [];
  const changed: Array<{ before: T; after: T }> = [];
  for (const [key, afterEntry] of afterByKey) {
    const beforeEntry = beforeByKey.get(key);
    if (!beforeEntry) added.push(afterEntry);
    else if (JSON.stringify(beforeEntry) !== JSON.stringify(afterEntry)) {
      changed.push({ before: beforeEntry, after: afterEntry });
    }
  }
  for (const [key, beforeEntry] of beforeByKey) {
    if (!afterByKey.has(key)) removed.push(beforeEntry);
  }
  return { added, removed, changed };
}

/**
 * Compare two dictionaries — the auditable core of "easy to compare and
 * update". Returns exactly what a league changed, keyed (not positional), so a
 * refresh can be logged, reviewed, or applied as a merge.
 */
export function diffDictionary(
  before: TradeDictionary | null,
  after: TradeDictionary,
): DictionaryDiff {
  const empty: TradeDictionary = before ?? {
    meta: { ...after.meta, counts: { stats: 0, items: 0, statics: 0 } },
    stats: [],
    items: [],
    statics: [],
  };
  const stats = diffDataset(empty.stats, after.stats, (entry) => entry.id);
  const items = diffDataset(empty.items, after.items, (entry) => entry.key);
  const statics = diffDataset(empty.statics, after.statics, (entry) => entry.id);
  const anyChange = (diff: DatasetDiff<unknown>): boolean =>
    diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0;
  return {
    schemaChanged: (before?.meta.schemaVersion ?? -1) !== after.meta.schemaVersion,
    dataVersionChanged: (before?.meta.dataVersion ?? '') !== after.meta.dataVersion,
    stats,
    items,
    statics,
    identical: !anyChange(stats) && !anyChange(items) && !anyChange(statics),
  };
}

/** One-line human summary of a diff for logs. */
export function summarizeDiff(diff: DictionaryDiff): string {
  const part = (name: string, dataset: DatasetDiff<unknown>): string =>
    `${name} +${dataset.added.length}/-${dataset.removed.length}/~${dataset.changed.length}`;
  return [part('stats', diff.stats), part('items', diff.items), part('static', diff.statics)].join(
    ', ',
  );
}

/** A dictionary must be rebuilt when its schema is old or it aged out. */
export function needsRebuild(
  dictionary: TradeDictionary | null,
  now: number,
  ttlMs: number,
): boolean {
  if (!dictionary) return true;
  if (dictionary.meta.schemaVersion !== DICTIONARY_SCHEMA_VERSION) return true;
  return now - new Date(dictionary.meta.fetchedAt).getTime() >= ttlMs;
}
