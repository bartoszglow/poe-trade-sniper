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
    // meta alone is ignored off mac → no modifier → not committable
    expect(
      acceleratorFromKeyChord({ ...base, code: 'KeyD', key: 'd', metaKey: true }, { isMac: false }),
    ).toBeNull();
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

  it('rejects a bare non-function key but allows a bare function key', () => {
    expect(
      acceleratorFromKeyChord({ ...base, code: 'KeyD', key: 'd' }, { isMac: true }),
    ).toBeNull();
    expect(acceleratorFromKeyChord({ ...base, code: 'F5', key: 'F5' }, { isMac: true })).toBe('F5');
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
