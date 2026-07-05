import { describe, expect, it } from 'vitest';
import { ROW_EXPAND_EXCLUDED_SELECTOR, shouldRowClickExpand } from './row-expand';

/** Minimal Element stand-in: `closest` matches when any listed token is an ancestor tag. */
function fakeTarget(ancestorTokens: string[]): { closest(selector: string): unknown } {
  return {
    closest(selector: string) {
      const wanted = selector.split(',').map((part) => part.trim());
      return wanted.some((token) => ancestorTokens.includes(token)) ? {} : null;
    },
  };
}

/** Header stand-in that claims (or disclaims) DOM containment of the target. */
function fakeHeader(containsTarget: boolean): { contains(node: unknown): boolean } {
  return { contains: () => containsTarget };
}

describe('shouldRowClickExpand', () => {
  it('expands for plain header content (text, spacer, badges)', () => {
    expect(shouldRowClickExpand(fakeHeader(true), fakeTarget([]))).toBe(true);
  });

  it.each(['button', 'a', 'input', 'select', 'textarea', '[role="switch"]', '[data-no-expand]'])(
    'ignores clicks on/inside %s',
    (token) => {
      expect(shouldRowClickExpand(fakeHeader(true), fakeTarget([token]))).toBe(false);
    },
  );

  it('tolerates non-element targets (window, text nodes stripped by React)', () => {
    expect(shouldRowClickExpand(null, null)).toBe(true);
    expect(shouldRowClickExpand(undefined, undefined)).toBe(true);
    expect(shouldRowClickExpand(fakeHeader(true), {})).toBe(true);
  });

  it('ignores clicks that bubble through a React portal (ConfirmDialog body/backdrop)', () => {
    // The dialog portals to document.body: the header does NOT contain the
    // target in the DOM even though the synthetic event reaches its onClick.
    expect(shouldRowClickExpand(fakeHeader(false), fakeTarget([]))).toBe(false);
  });

  it('ignores clicks that end a text-selection drag (copying the search id)', () => {
    expect(shouldRowClickExpand(fakeHeader(true), fakeTarget([]), { isCollapsed: false })).toBe(
      false,
    );
    expect(shouldRowClickExpand(fakeHeader(true), fakeTarget([]), { isCollapsed: true })).toBe(
      true,
    );
    expect(shouldRowClickExpand(fakeHeader(true), fakeTarget([]), null)).toBe(true);
  });

  it('keeps the drag handle in the exclusion selector', () => {
    expect(ROW_EXPAND_EXCLUDED_SELECTOR).toContain('[data-no-expand]');
  });
});
