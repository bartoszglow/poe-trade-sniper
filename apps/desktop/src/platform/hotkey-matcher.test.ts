import { describe, expect, it } from 'vitest';
import {
  matchesModifiers,
  parseHotkey,
  uiohookKeyName,
  type HotkeyEvent,
} from './hotkey-matcher.js';

const chord = (over: Partial<HotkeyEvent>): HotkeyEvent => ({
  keycode: 0,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...over,
});

describe('parseHotkey', () => {
  it('maps CommandOrControl to meta on mac, ctrl off mac', () => {
    expect(parseHotkey('CommandOrControl+Shift+D', true)).toEqual({
      keyName: 'D',
      ctrl: false,
      alt: false,
      shift: true,
      meta: true,
    });
    expect(parseHotkey('CommandOrControl+Shift+D', false)).toEqual({
      keyName: 'D',
      ctrl: true,
      alt: false,
      shift: true,
      meta: false,
    });
  });

  it('parses a bare single key + a large combo', () => {
    expect(parseHotkey('F5', true)).toEqual({
      keyName: 'F5',
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
    });
    expect(parseHotkey('CommandOrControl+Alt+Shift+D', false)).toMatchObject({
      keyName: 'D',
      ctrl: true,
      alt: true,
      shift: true,
    });
  });

  it('remaps tokens that differ from uiohook names', () => {
    expect(uiohookKeyName('Return')).toBe('Enter');
    expect(uiohookKeyName('Up')).toBe('ArrowUp');
    expect(uiohookKeyName('num5')).toBe('Numpad5');
    expect(uiohookKeyName('`')).toBe('Backquote');
    expect(uiohookKeyName('D')).toBe('D');
  });

  it('returns null when there is no main key (modifiers only)', () => {
    expect(parseHotkey('CommandOrControl+Shift', true)).toBeNull();
    expect(parseHotkey('', true)).toBeNull();
  });
});

describe('matchesModifiers', () => {
  const ctrlShiftD = parseHotkey('CommandOrControl+Shift+D', false)!;
  const bareD = parseHotkey('D', false)!;

  it('requires an EXACT modifier match', () => {
    expect(matchesModifiers(ctrlShiftD, chord({ ctrlKey: true, shiftKey: true }))).toBe(true);
    // an extra modifier held → no match
    expect(
      matchesModifiers(ctrlShiftD, chord({ ctrlKey: true, shiftKey: true, altKey: true })),
    ).toBe(false);
    // a bare key must NOT match when a modifier is held (D vs Ctrl+D)
    expect(matchesModifiers(bareD, chord({ ctrlKey: true }))).toBe(false);
    expect(matchesModifiers(bareD, chord({}))).toBe(true);
  });
});
