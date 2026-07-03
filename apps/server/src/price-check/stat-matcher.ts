/**
 * Matches parsed mod lines to trade stat ids (#37). PURE.
 *
 * GGG's `/api/trade2/data/stats` gives every searchable stat as
 * `{ id: 'explicit.stat_...', text: '+# to maximum Life', type: 'explicit' }`.
 * The `#` are numeric-roll placeholders (and `+#%`, `#%`, etc.). We compile
 * each template into a regex that captures the rolls, then match a mod line
 * against the compiled table, preferring the SAME domain (an implicit and an
 * explicit can share text) and the most-specific (longest) template.
 */
import type { ModDomain } from './item-text-parser.js';

export interface StatEntry {
  id: string;
  text: string;
  /** explicit / implicit / enchant / rune / … — from the dictionary group. */
  type: string;
}

export interface CompiledStat {
  id: string;
  type: string;
  text: string;
  regex: RegExp;
  /** Template length — longer = more specific, wins ties. */
  specificity: number;
}

export interface StatMatch {
  statId: string;
  text: string;
  /** Dictionary stat type (explicit/implicit/rune/…) — used by the editor draft. */
  type: string;
  values: number[];
}

const PLACEHOLDER = /#/g; // escapeRegExp leaves '#' as-is, so match it directly
const NUMBER_CAPTURE = '([+-]?\\d+(?:\\.\\d+)?)';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Compile the dictionary into matchers, most-specific first. */
export function compileStats(entries: StatEntry[]): CompiledStat[] {
  const compiled: CompiledStat[] = [];
  for (const entry of entries) {
    if (!entry.text.includes('#')) {
      // Flag-style stat (no roll) — exact match on the whole line.
      compiled.push({
        id: entry.id,
        type: entry.type,
        text: entry.text,
        regex: new RegExp(`^${escapeRegExp(entry.text)}$`),
        specificity: entry.text.length,
      });
      continue;
    }
    const pattern = escapeRegExp(entry.text).replace(PLACEHOLDER, NUMBER_CAPTURE);
    compiled.push({
      id: entry.id,
      type: entry.type,
      text: entry.text,
      regex: new RegExp(`^${pattern}$`),
      specificity: entry.text.length,
    });
  }
  // Longer templates first so "+#% to Fire Resistance" beats a looser "#% ...".
  return compiled.sort((first, second) => second.specificity - first.specificity);
}

/** Map an item mod domain to the dictionary `type` we should prefer. */
function preferredTypes(domain: ModDomain): string[] {
  switch (domain) {
    case 'implicit':
      return ['implicit'];
    case 'enchant':
      return ['enchant'];
    case 'rune':
      return ['rune'];
    // fractured/crafted/desecrated all sit in the explicit stat space on trade.
    default:
      return ['explicit'];
  }
}

/**
 * Match one mod line. Tries the domain-preferred stat types first, then any
 * type as a fallback (so an odd domain tag never blocks a real match).
 */
export function matchModLine(
  compiled: CompiledStat[],
  line: { text: string; domain: ModDomain },
): StatMatch | null {
  const preferred = preferredTypes(line.domain);
  const tryMatch = (candidates: CompiledStat[]): StatMatch | null => {
    for (const stat of candidates) {
      const match = stat.regex.exec(line.text);
      if (!match) continue;
      const values = match.slice(1).map(Number).filter(Number.isFinite);
      return { statId: stat.id, text: stat.text, type: stat.type, values };
    }
    return null;
  };
  return (
    tryMatch(compiled.filter((stat) => preferred.includes(stat.type))) ??
    tryMatch(compiled.filter((stat) => !preferred.includes(stat.type)))
  );
}
