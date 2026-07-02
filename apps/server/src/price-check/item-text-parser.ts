/**
 * Parser for Path of Exile 2's Ctrl+C item text (#37). PURE — no I/O.
 *
 * The clipboard format is sections separated by lines of dashes; the first
 * section carries `Item Class:`, `Rarity:`, the item name and (for non-unique
 * gear) a base-type line. Later sections carry requirements, sockets, item
 * level, and the modifier lines. Mod lines end with a domain tag the game
 * appends — ` (implicit)`, ` (rune)`, ` (enchant)`, ` (fractured)`, ` (crafted)`,
 * ` (desecrated)` — or none for a plain explicit. Standalone status lines
 * (Unidentified, Corrupted, Mirrored) and `Note:`/`Requirements:` blocks are
 * recognised so they never leak into the mod list.
 *
 * EN-only for now (D-pc-7). Unmatched-to-a-stat handling happens later; this
 * layer only SPLITS text into a structured item + candidate mod lines.
 */

export type ModDomain =
  | 'explicit'
  | 'implicit'
  | 'rune'
  | 'enchant'
  | 'fractured'
  | 'crafted'
  | 'desecrated';

export interface ParsedModLine {
  /** The mod text with the trailing ` (domain)` tag stripped. */
  text: string;
  domain: ModDomain;
}

export interface ParsedItem {
  itemClass: string | null;
  rarity: string | null;
  name: string | null;
  baseType: string | null;
  itemLevel: number | null;
  quality: number | null;
  corrupted: boolean;
  unidentified: boolean;
  modLines: ParsedModLine[];
}

const SECTION_SEPARATOR = /^-+$/;

/** Trailing ` (domain)` tag → its ModDomain, else null (plain explicit). */
const DOMAIN_TAGS: Array<{ suffix: string; domain: ModDomain }> = [
  { suffix: ' (implicit)', domain: 'implicit' },
  { suffix: ' (rune)', domain: 'rune' },
  { suffix: ' (enchant)', domain: 'enchant' },
  { suffix: ' (fractured)', domain: 'fractured' },
  { suffix: ' (crafted)', domain: 'crafted' },
  { suffix: ' (desecrated)', domain: 'desecrated' },
];

/** Lines inside a mod section that are NOT modifiers (metadata / status). */
const NON_MOD_PREFIXES = [
  'Requirements:',
  'Level:',
  'Str:',
  'Dex:',
  'Int:',
  'Sockets:',
  'Item Level:',
  'Quality:',
  'Note:',
  'Stack Size:',
  'Rune sockets:',
  'Corrupted',
  'Mirrored',
  'Unidentified',
  'Waystone Tier:',
  'Requires ',
  'Allocated ',
];

function splitSections(itemText: string): string[][] {
  const sections: string[][] = [[]];
  for (const rawLine of itemText.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (SECTION_SEPARATOR.test(line.trim())) {
      sections.push([]);
      continue;
    }
    if (line.trim() === '') continue;
    sections[sections.length - 1]!.push(line);
  }
  return sections.filter((section) => section.length > 0);
}

function stripDomainTag(line: string): ParsedModLine | null {
  for (const { suffix, domain } of DOMAIN_TAGS) {
    if (line.endsWith(suffix)) {
      return { text: line.slice(0, -suffix.length), domain };
    }
  }
  return { text: line, domain: 'explicit' };
}

function fieldValue(line: string, prefix: string): string | null {
  return line.startsWith(prefix) ? line.slice(prefix.length).trim() : null;
}

/** Parse the header section (class / rarity / name / base type). */
function parseHeader(
  section: string[],
): Pick<ParsedItem, 'itemClass' | 'rarity' | 'name' | 'baseType'> {
  let itemClass: string | null = null;
  let rarity: string | null = null;
  const nameLines: string[] = [];
  for (const line of section) {
    const classValue = fieldValue(line, 'Item Class:');
    const rarityValue = fieldValue(line, 'Rarity:');
    if (classValue !== null) {
      itemClass = classValue;
      continue;
    }
    if (rarityValue !== null) {
      rarity = rarityValue;
      continue;
    }
    nameLines.push(line);
  }
  // After the Class/Rarity lines the header holds the item name and, for named
  // rares/uniques, a base-type line beneath it. A Normal/Currency item has just
  // the base type as its "name".
  const name = nameLines[0] ?? null;
  const baseType = nameLines.length > 1 ? (nameLines[1] ?? null) : name;
  return { itemClass, rarity, name, baseType };
}

/** A `Label: value` property/requirement line (e.g. `Energy Shield: 124`) — a
 *  real mod line never leads with a `Word…:`. */
const PROPERTY_LINE = /^[A-Za-z][A-Za-z ]*:/;

function isNonModLine(line: string): boolean {
  if (NON_MOD_PREFIXES.some((prefix) => line === prefix || line.startsWith(prefix))) return true;
  return PROPERTY_LINE.test(line);
}

export function parseItemText(itemText: string): ParsedItem {
  const sections = splitSections(itemText);
  const header = parseHeader(sections[0] ?? []);

  const item: ParsedItem = {
    ...header,
    itemLevel: null,
    quality: null,
    corrupted: false,
    unidentified: false,
    modLines: [],
  };

  // Every section AFTER the header can carry metadata, status flags, or mods.
  for (const section of sections.slice(1)) {
    for (const line of section) {
      const itemLevelValue = fieldValue(line, 'Item Level:');
      if (itemLevelValue !== null) {
        const parsed = Number.parseInt(itemLevelValue, 10);
        if (Number.isFinite(parsed)) item.itemLevel = parsed;
        continue;
      }
      const qualityValue = fieldValue(line, 'Quality:');
      if (qualityValue !== null) {
        const parsed = Number.parseInt(qualityValue.replace(/[+%]/g, ''), 10);
        if (Number.isFinite(parsed)) item.quality = parsed;
        continue;
      }
      if (line === 'Corrupted') {
        item.corrupted = true;
        continue;
      }
      if (line === 'Unidentified') {
        item.unidentified = true;
        continue;
      }
      if (isNonModLine(line)) continue;
      const modLine = stripDomainTag(line);
      if (modLine) item.modLines.push(modLine);
    }
  }
  return item;
}
