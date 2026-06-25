import { describe, expect, it } from 'vitest';
import { toCsv } from './csv.js';

describe('toCsv', () => {
  it('writes a header row then the records (CRLF)', () => {
    expect(toCsv([{ a: 1, b: 'x' }], ['a', 'b'])).toBe('a,b\r\n1,x');
  });

  it('quotes cells with commas/quotes/newlines and doubles inner quotes', () => {
    const csv = toCsv([{ a: 'x,y', b: 'he said "hi"', c: 'l1\nl2' }], ['a', 'b', 'c']);
    expect(csv).toBe('a,b,c\r\n"x,y","he said ""hi""","l1\nl2"');
  });

  it('renders null/undefined as empty cells', () => {
    expect(toCsv([{ a: null, b: undefined }], ['a', 'b'])).toBe('a,b\r\n,');
  });

  it('only emits the named columns, in order', () => {
    expect(toCsv([{ b: 2, a: 1, c: 3 }], ['a', 'b'])).toBe('a,b\r\n1,2');
  });

  it('neutralizes spreadsheet formula triggers in text cells (CSV injection)', () => {
    expect(toCsv([{ a: '@evil' }], ['a'])).toBe("a\r\n'@evil");
    expect(toCsv([{ a: '=HYPERLINK("x")' }], ['a'])).toBe('a\r\n"\'=HYPERLINK(""x"")"');
    expect(toCsv([{ a: '+1' }, { a: '-1' }], ['a'])).toBe("a\r\n'+1\r\n'-1");
  });

  it('does not guard numeric cells (a negative number stays numeric)', () => {
    expect(toCsv([{ a: -1 }], ['a'])).toBe('a\r\n-1');
  });
});
