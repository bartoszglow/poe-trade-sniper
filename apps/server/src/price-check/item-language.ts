/**
 * Item-text language support (#38 C). The Ctrl+C parser is driven by a per-language
 * LEXICON (the localized section labels / status words), so adding a language =
 * adding a lexicon entry (open/closed) — no parser edits. Language is DETECTED from
 * the localized header labels.
 *
 * EN is the only VERIFIED lexicon. Other languages need GGG's exact localized
 * strings + a per-language stat dictionary host, which cannot be validated here
 * (hard rules #2/#8): their lexicons are stubs marked `TODO(verify)` — populate and
 * confirm on-machine before enabling. Detection falls back to EN, so an unknown
 * language never breaks a parse.
 */

export type LanguageCode = 'en' | 'de' | 'fr' | 'es' | 'pt' | 'ru' | 'ko';

export interface DomainTag {
  suffix: string;
  domain: 'implicit' | 'rune' | 'enchant' | 'fractured' | 'crafted' | 'desecrated';
}

export interface ParserLexicon {
  language: LanguageCode;
  /** Prefix of the "Item Class:" header line. */
  itemClassLabel: string;
  /** Prefix of the "Rarity:" header line. */
  rarityLabel: string;
  itemLevelLabel: string;
  qualityLabel: string;
  corruptedWord: string;
  unidentifiedWord: string;
  /** Non-mod metadata/status line prefixes in this language. */
  nonModPrefixes: string[];
  /** Trailing ` (domain)` tags in this language. */
  domainTags: DomainTag[];
}

export const EN_LEXICON: ParserLexicon = {
  language: 'en',
  itemClassLabel: 'Item Class:',
  rarityLabel: 'Rarity:',
  itemLevelLabel: 'Item Level:',
  qualityLabel: 'Quality:',
  corruptedWord: 'Corrupted',
  unidentifiedWord: 'Unidentified',
  nonModPrefixes: [
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
  ],
  domainTags: [
    { suffix: ' (implicit)', domain: 'implicit' },
    { suffix: ' (rune)', domain: 'rune' },
    { suffix: ' (enchant)', domain: 'enchant' },
    { suffix: ' (fractured)', domain: 'fractured' },
    { suffix: ' (crafted)', domain: 'crafted' },
    { suffix: ' (desecrated)', domain: 'desecrated' },
  ],
};

/**
 * Non-EN lexicons — STUBS. `itemClassLabel`/`rarityLabel` are populated from public
 * knowledge to drive DETECTION, but the full field labels / status words / domain
 * tags need GGG's exact localized strings (`TODO(verify)`, no live probe here). Until
 * a lexicon is fully populated + verified, its parse falls back to EN behaviour for
 * the unpopulated fields. Do NOT enable a language for real parsing until verified.
 */
const STUB_LANGUAGE_LABELS: Array<
  Pick<ParserLexicon, 'language' | 'itemClassLabel' | 'rarityLabel'>
> = [
  { language: 'de', itemClassLabel: 'Gegenstandsklasse:', rarityLabel: 'Seltenheit:' }, // TODO(verify)
  { language: 'fr', itemClassLabel: "Classe d'objet:", rarityLabel: 'Rareté:' }, // TODO(verify)
  { language: 'es', itemClassLabel: 'Clase de objeto:', rarityLabel: 'Rareza:' }, // TODO(verify)
  { language: 'pt', itemClassLabel: 'Classe do Item:', rarityLabel: 'Raridade:' }, // TODO(verify)
  { language: 'ru', itemClassLabel: 'Класс предмета:', rarityLabel: 'Редкость:' }, // TODO(verify)
  { language: 'ko', itemClassLabel: '아이템 종류:', rarityLabel: '희귀도:' }, // TODO(verify)
];

/** Every lexicon by language. Only EN is fully populated; stubs inherit EN fields. */
export const LANGUAGE_LEXICONS: Record<LanguageCode, ParserLexicon> = {
  en: EN_LEXICON,
  ...(Object.fromEntries(
    STUB_LANGUAGE_LABELS.map((stub) => [stub.language, { ...EN_LEXICON, ...stub }]),
  ) as Record<Exclude<LanguageCode, 'en'>, ParserLexicon>),
};

/**
 * Detect the item-text language from its localized "Item Class:" header label.
 * Falls back to EN so an unknown language never blocks a parse.
 */
export function detectLanguage(itemText: string): LanguageCode {
  const firstLines = itemText.split(/\r?\n/, 8);
  for (const lexicon of Object.values(LANGUAGE_LEXICONS)) {
    if (lexicon.language === 'en') continue;
    if (firstLines.some((line) => line.startsWith(lexicon.itemClassLabel))) {
      return lexicon.language;
    }
  }
  return 'en';
}

export function lexiconFor(language: LanguageCode): ParserLexicon {
  return LANGUAGE_LEXICONS[language] ?? EN_LEXICON;
}
