/**
 * Trade-query JSON → presentable criteria structure for QueryCriteriaView.
 *
 * The GGG query schema is undocumented and evolves; the cardinal rule here is
 * NEVER HIDE DATA. Everything recognized renders nicely; everything else falls
 * back to raw key + JSON value, so the operator always sees the full truth of
 * what the search matches.
 */

export interface CriteriaRow {
  label: string;
  value: string;
  disabled: boolean;
}

export interface StatGroup {
  /** Group mode as shown on the trade site: AND / OR / COUNT / WEIGHT … */
  heading: string;
  disabled: boolean;
  rows: CriteriaRow[];
}

export interface FilterGroup {
  /** Raw group key (`type_filters`) — the view maps known keys to i18n titles. */
  key: string;
  disabled: boolean;
  rows: CriteriaRow[];
}

export interface ParsedCriteria {
  /** name / type / free-text term, already humanized. */
  itemRows: CriteriaRow[];
  /** `status.option` — purchase scope (securable = Instant Buyout). */
  statusOption: string | null;
  /** "max 400 exalted" — pulled out of trade_filters for top billing. */
  price: string | null;
  statGroups: StatGroup[];
  filterGroups: FilterGroup[];
  /** Unrecognized top-level query keys — rendered raw, never dropped. */
  unknownRows: CriteriaRow[];
}

const KNOWN_TOP_LEVEL_KEYS = new Set(['status', 'name', 'type', 'term', 'stats', 'filters']);
const KNOWN_VALUE_KEYS = new Set(['option', 'min', 'max', 'input', 'weight']);

/** Common filter keys → human labels; anything else gets prettified. */
const FILTER_LABELS: Record<string, string> = {
  category: 'Category',
  rarity: 'Rarity',
  ilvl: 'Item Level',
  quality: 'Quality',
  sockets: 'Sockets',
  rune_sockets: 'Rune Sockets',
  corrupted: 'Corrupted',
  identified: 'Identified',
  mirrored: 'Mirrored',
  alternate_art: 'Alternate Art',
  price: 'Price',
  indexed: 'Listed',
  account: 'Seller',
  sale_type: 'Sale Type',
  lvl: 'Level',
  str: 'Strength',
  dex: 'Dexterity',
  int: 'Intelligence',
  es: 'Energy Shield',
  ev: 'Evasion',
  ar: 'Armour',
  block: 'Block',
  spirit: 'Spirit',
  dps: 'DPS',
  pdps: 'Physical DPS',
  edps: 'Elemental DPS',
  aps: 'Attacks per Second',
  crit: 'Critical Chance',
  damage: 'Damage',
  gem_level: 'Gem Level',
  gem_sockets: 'Gem Sockets',
  area_level: 'Area Level',
  stack_size: 'Stack Size',
};

/** Lint-safe stringification: scalars verbatim, anything else as JSON. */
function scalarText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value) ?? '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** null/undefined = "not set" — GGG stores empty bounds as null (`min: null`). */
function present(value: unknown): boolean {
  return value !== undefined && value !== null;
}

/** `gem_level` → `Gem Level` for keys outside the known map. */
function prettifyKey(key: string): string {
  return key
    .split('_')
    .map((word) => (word ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(' ');
}

export function filterLabel(key: string): string {
  return FILTER_LABELS[key] ?? prettifyKey(key);
}

function humanOption(option: unknown): string {
  if (option === 'true' || option === true) return 'yes';
  if (option === 'false' || option === false) return 'no';
  return scalarText(option);
}

/**
 * Generic filter value → string. Handles the trade-site shapes ({option},
 * {min,max}, {input}, combinations); leftovers are appended as raw JSON.
 */
export function formatFilterValue(value: unknown): string {
  if (!present(value)) return '';
  if (!isRecord(value)) return scalarText(value);
  const parts: string[] = [];
  if (present(value['option'])) parts.push(humanOption(value['option']));
  if (present(value['min'])) parts.push(`min ${scalarText(value['min'])}`);
  if (present(value['max'])) parts.push(`max ${scalarText(value['max'])}`);
  if (present(value['input'])) parts.push(scalarText(value['input']));
  if (present(value['weight'])) parts.push(`weight ${scalarText(value['weight'])}`);
  const leftoverKeys = Object.keys(value).filter(
    (key) => !KNOWN_VALUE_KEYS.has(key) && present(value[key]),
  );
  if (leftoverKeys.length > 0 || parts.length === 0) {
    parts.push(JSON.stringify(Object.fromEntries(leftoverKeys.map((key) => [key, value[key]]))));
  }
  return parts.join(' · ');
}

/**
 * A bare exalted amount rendered divine-aware for deal-mode auto-caps
 * (option-less prices are value-converted in exalted, plan 41 D-dw-6). Kept
 * inline — not imported from deal-watch-display — to avoid a dependency cycle
 * (that module imports parseQueryCriteria). `≥ 1 divine → "26.3 div"`, else ex.
 */
function formatBareExalted(amountExalted: number, divineRate: number): string {
  if (amountExalted < divineRate) return `${Math.round(amountExalted)} ex`;
  const divine = amountExalted / divineRate;
  const rounded = Number(divine.toFixed(1));
  return `${rounded} div (${Math.round(amountExalted)} ex)`;
}

/**
 * Price reads as a range with the currency last: `≤ 100 exalted`, `5–40 divine`.
 * The currency lives in `option` and is often absent (no currency picked). A
 * bare bound normally shows as-is; but when `divineRate` is supplied (deal-mode
 * ItemCard) an option-less single bound is a value-converted exalted cap, so it
 * renders divine-aware instead of an unreadable five-figure exalted number.
 */
function formatPrice(value: unknown, divineRate: number | null): string {
  if (!isRecord(value)) return formatFilterValue(value);
  const min = value['min'];
  const max = value['max'];
  const hasOption = present(value['option']);
  const currency = hasOption ? scalarText(value['option']) : '';
  // Deal-mode auto-cap: option-less single bound + a known divine rate.
  if (divineRate !== null && divineRate > 0 && !hasOption) {
    const sole = present(max) && !present(min) ? max : present(min) && !present(max) ? min : null;
    if (typeof sole === 'number' && Number.isFinite(sole)) {
      const prefix = present(max) ? '≤ ' : '≥ ';
      return `${prefix}${formatBareExalted(sole, divineRate)}`;
    }
  }
  let range = '';
  if (present(min) && present(max)) range = `${scalarText(min)}–${scalarText(max)}`;
  else if (present(max)) range = `≤ ${scalarText(max)}`;
  else if (present(min)) range = `≥ ${scalarText(min)}`;
  const combined = [range, currency].filter(Boolean).join(' ');
  return combined || formatFilterValue(value);
}

/** name/type can be a string or `{option, discriminator}`. */
function topLevelText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (isRecord(value) && typeof value['option'] === 'string') return value['option'];
  return JSON.stringify(value);
}

function parseStatGroups(stats: unknown, statsById: Map<string, string> | null): StatGroup[] {
  if (!Array.isArray(stats)) return [];
  const groups: StatGroup[] = [];
  for (const group of stats) {
    if (!isRecord(group)) continue;
    const type = typeof group['type'] === 'string' ? group['type'].toUpperCase() : 'AND';
    const groupValue = isRecord(group['value']) ? formatFilterValue(group['value']) : '';
    const rows: CriteriaRow[] = [];
    if (Array.isArray(group['filters'])) {
      for (const filter of group['filters']) {
        if (!isRecord(filter)) continue;
        const statId = typeof filter['id'] === 'string' ? filter['id'] : '?';
        rows.push({
          label: statsById?.get(statId) ?? statId,
          value: formatFilterValue(filter['value']),
          disabled: filter['disabled'] === true,
        });
      }
    }
    if (rows.length === 0) continue;
    groups.push({
      heading: groupValue ? `${type} · ${groupValue}` : type,
      disabled: group['disabled'] === true,
      rows,
    });
  }
  return groups;
}

export function parseQueryCriteria(
  query: unknown,
  statsById: Map<string, string> | null,
  /** When set, an option-less price bound renders divine-aware (deal-mode cap). */
  divineRate: number | null = null,
): ParsedCriteria {
  const parsed: ParsedCriteria = {
    itemRows: [],
    statusOption: null,
    price: null,
    statGroups: [],
    filterGroups: [],
    unknownRows: [],
  };
  if (!isRecord(query)) return parsed;

  // Item identity: name / base type / free-text term.
  if (query['name'] !== undefined) {
    parsed.itemRows.push({ label: 'Name', value: topLevelText(query['name']), disabled: false });
  }
  if (query['type'] !== undefined) {
    parsed.itemRows.push({ label: 'Type', value: topLevelText(query['type']), disabled: false });
  }
  if (typeof query['term'] === 'string' && query['term'] !== '') {
    parsed.itemRows.push({ label: 'Term', value: `"${query['term']}"`, disabled: false });
  }

  // Purchase scope.
  const status = query['status'];
  if (typeof status === 'string') parsed.statusOption = status;
  else if (isRecord(status) && typeof status['option'] === 'string') {
    parsed.statusOption = status['option'];
  }

  parsed.statGroups = parseStatGroups(query['stats'], statsById);

  // Filter groups — iterated generically so new GGG groups appear untouched.
  if (isRecord(query['filters'])) {
    for (const [groupKey, group] of Object.entries(query['filters'])) {
      if (!isRecord(group)) continue;
      const rows: CriteriaRow[] = [];
      const inner = isRecord(group['filters']) ? group['filters'] : {};
      for (const [filterKey, filterValue] of Object.entries(inner)) {
        if (groupKey === 'trade_filters' && filterKey === 'price') {
          parsed.price = formatPrice(filterValue, divineRate);
          continue;
        }
        rows.push({
          label: filterLabel(filterKey),
          value: formatFilterValue(filterValue),
          disabled: false,
        });
      }
      if (rows.length === 0) continue;
      parsed.filterGroups.push({ key: groupKey, disabled: group['disabled'] === true, rows });
    }
  }

  // Never hide data: unrecognized top-level keys render raw.
  for (const [key, value] of Object.entries(query)) {
    if (KNOWN_TOP_LEVEL_KEYS.has(key)) continue;
    parsed.unknownRows.push({ label: key, value: JSON.stringify(value), disabled: false });
  }

  return parsed;
}
