import { describe, expect, it } from 'vitest';
import { acceleratorFromKeyChord, formatAccelerator, isModifierOnly } from './hotkey';

const base = { key: '', code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };

describe('acceleratorFromKeyChord', () => {
  it('builds CommandOrControl+Shift+D from Cmd+Shift+D on mac', () => {
    expect(
      acceleratorFromKeyChord(
        { ...base, code: 'KeyD', key: 'D', metaKey: true, shiftKey: true },
        { isMac: true },
      ),
    ).toBe('CommandOrControl+Shift+D');
  });

  it('uses ctrl (not meta) as the primary modifier off mac', () => {
    expect(
      acceleratorFromKeyChord(
        { ...base, code: 'KeyD', key: 'd', ctrlKey: true, shiftKey: true },
        { isMac: false },
      ),
    ).toBe('CommandOrControl+Shift+D');
    // meta is ignored off mac → no primary modifier, but the bare key still commits
    expect(
      acceleratorFromKeyChord({ ...base, code: 'KeyD', key: 'd', metaKey: true }, { isMac: false }),
    ).toBe('D');
  });

  it('keeps listening (null) on modifier-only presses', () => {
    expect(
      acceleratorFromKeyChord(
        { ...base, code: 'ShiftLeft', key: 'Shift', shiftKey: true },
        { isMac: true },
      ),
    ).toBeNull();
    expect(isModifierOnly({ ...base, code: 'MetaLeft', key: 'Meta' })).toBe(true);
  });

  it('allows ANY bare single key (single-key hotkeys): function / letter / punctuation', () => {
    expect(acceleratorFromKeyChord({ ...base, code: 'F5', key: 'F5' }, { isMac: true })).toBe('F5');
    expect(acceleratorFromKeyChord({ ...base, code: 'KeyD', key: 'd' }, { isMac: true })).toBe('D');
    expect(acceleratorFromKeyChord({ ...base, code: 'Backquote', key: '`' }, { isMac: true })).toBe(
      '`',
    );
  });

  it('builds a larger 3-key combo', () => {
    expect(
      acceleratorFromKeyChord(
        { ...base, code: 'KeyD', key: 'd', ctrlKey: true, altKey: true, shiftKey: true },
        { isMac: false },
      ),
    ).toBe('CommandOrControl+Alt+Shift+D');
  });

  it('maps digits, arrows, and punctuation codes', () => {
    expect(
      acceleratorFromKeyChord(
        { ...base, code: 'Digit1', key: '1', altKey: true },
        { isMac: false },
      ),
    ).toBe('Alt+1');
    expect(
      acceleratorFromKeyChord(
        { ...base, code: 'ArrowUp', key: 'ArrowUp', ctrlKey: true },
        { isMac: false },
      ),
    ).toBe('CommandOrControl+Up');
  });

  it('never commits Escape (that cancels recording)', () => {
    expect(
      acceleratorFromKeyChord(
        { ...base, code: 'Escape', key: 'Escape', shiftKey: true },
        { isMac: true },
      ),
    ).toBeNull();
  });
});

describe('formatAccelerator', () => {
  it('renders mac symbols with no separators', () => {
    expect(formatAccelerator('CommandOrControl+Shift+D', { isMac: true })).toBe('⌘⇧D');
  });

  it('renders plus-joined tokens off mac', () => {
    expect(formatAccelerator('CommandOrControl+Shift+D', { isMac: false })).toBe('Ctrl+Shift+D');
  });

  it('is empty for an empty accelerator', () => {
    expect(formatAccelerator('', { isMac: true })).toBe('');
  });
});
