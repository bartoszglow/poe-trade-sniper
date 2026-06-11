import { describe, expect, it } from 'vitest';
import { parseSearchInput, parseTradeSearchUrl, queryStatusOption } from './search-input.js';

describe('parseSearchInput', () => {
  it('treats a bare id as a poe2 search in the default league', () => {
    expect(parseSearchInput('3ZPmDyGs5', 'Standard')).toEqual({
      realm: 'poe2',
      league: 'Standard',
      searchId: '3ZPmDyGs5',
    });
  });

  it('parses a trade page URL (with /live suffix and encoded league)', () => {
    expect(
      parseSearchInput(
        'https://www.pathofexile.com/trade2/search/poe2/Rise%20of%20the%20Abyssal/AbCdEf123/live',
        'Standard',
      ),
    ).toEqual({ realm: 'poe2', league: 'Rise of the Abyssal', searchId: 'AbCdEf123' });
  });

  it('parses a websocket URL', () => {
    expect(
      parseTradeSearchUrl('wss://www.pathofexile.com/api/trade2/live/poe2/Standard/XyZ987'),
    ).toEqual({ realm: 'poe2', league: 'Standard', searchId: 'XyZ987' });
  });

  it('rejects garbage', () => {
    expect(() => parseSearchInput('not a search!!', 'Standard')).toThrowError(/does not look like/);
    expect(() => parseTradeSearchUrl('https://example.com/foo')).toThrowError(/Unrecognized/);
  });
});

describe('queryStatusOption', () => {
  it('reads status.option when present', () => {
    expect(queryStatusOption({ status: { option: 'securable' } })).toBe('securable');
    expect(queryStatusOption({ status: {} })).toBeNull();
    expect(queryStatusOption(null)).toBeNull();
  });
});
