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
 * Language-driven (#38 C): the localized section labels / status words / domain
 * tags come from a `ParserLexicon` (default EN), so a new language is a lexicon
 * entry, not a parser edit. Unmatched-to-a-stat handling happens later; this layer
 * only SPLITS text into a structured item + candidate mod lines.
 */
import { EN_LEXICON, type ParserLexicon } from './item-language.js';

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

function stripDomainTag(line: string, lexicon: ParserLexicon): ParsedModLine {
  for (const { suffix, domain } of lexicon.domainTags) {
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
  lexicon: ParserLexicon,
): Pick<ParsedItem, 'itemClass' | 'rarity' | 'name' | 'baseType'> {
  let itemClass: string | null = null;
  let rarity: string | null = null;
  const nameLines: string[] = [];
  for (const line of section) {
    const classValue = fieldValue(line, lexicon.itemClassLabel);
    const rarityValue = fieldValue(line, lexicon.rarityLabel);
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

function isNonModLine(line: string, lexicon: ParserLexicon): boolean {
  if (lexicon.nonModPrefixes.some((prefix) => line === prefix || line.startsWith(prefix))) {
    return true;
  }
  return PROPERTY_LINE.test(line);
}

export function parseItemText(itemText: string, lexicon: ParserLexicon = EN_LEXICON): ParsedItem {
  const sections = splitSections(itemText);
  const header = parseHeader(sections[0] ?? [], lexicon);

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
      const itemLevelValue = fieldValue(line, lexicon.itemLevelLabel);
      if (itemLevelValue !== null) {
        const parsed = Number.parseInt(itemLevelValue, 10);
        if (Number.isFinite(parsed)) item.itemLevel = parsed;
        continue;
      }
      const qualityValue = fieldValue(line, lexicon.qualityLabel);
      if (qualityValue !== null) {
        const parsed = Number.parseInt(qualityValue.replace(/[+%]/g, ''), 10);
        if (Number.isFinite(parsed)) item.quality = parsed;
        continue;
      }
      if (line === lexicon.corruptedWord) {
        item.corrupted = true;
        continue;
      }
      if (line === lexicon.unidentifiedWord) {
        item.unidentified = true;
        continue;
      }
      if (isNonModLine(line, lexicon)) continue;
      item.modLines.push(stripDomainTag(line, lexicon));
    }
  }
  return item;
}
