import { describe, expect, it } from 'vitest';
import { detectLanguage } from './item-language.js';
import { parseItemText } from './item-text-parser.js';

describe('detectLanguage', () => {
  it('defaults to EN, and detects EN from its header', () => {
    expect(detectLanguage('Item Class: Rings\nRarity: Rare')).toBe('en');
    expect(detectLanguage('unrecognizable text')).toBe('en');
  });

  it('detects a non-EN language from its localized Item Class label (stub)', () => {
    expect(detectLanguage('Gegenstandsklasse: Ringe\nSeltenheit: Selten')).toBe('de');
  });
});

describe('lexicon-driven parser (EN default unchanged)', () => {
  it('parses an EN item with the default lexicon', () => {
    const parsed = parseItemText(
      [
        'Item Class: Rings',
        'Rarity: Rare',
        'Sample Name',
        'Gold Ring',
        '--------',
        'Item Level: 80',
        '--------',
        '+25 to maximum Life',
        'Corrupted',
      ].join('\n'),
    );
    expect(parsed.itemClass).toBe('Rings');
    expect(parsed.rarity).toBe('Rare');
    expect(parsed.baseType).toBe('Gold Ring');
    expect(parsed.itemLevel).toBe(80);
    expect(parsed.corrupted).toBe(true);
    expect(parsed.modLines.map((mod) => mod.text)).toContain('+25 to maximum Life');
  });
});
