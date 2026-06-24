import { describe, expect, it } from 'vitest';
import { resolveBuyControl } from './resolve-buy-control';

const MAC_DESKTOP = { isDesktop: true, isMac: true } as const;

describe('resolveBuyControl (decision #2=B Buy gating)', () => {
  it('web (not desktop) → disabled, off, web-only note', () => {
    expect(
      resolveBuyControl({ isDesktop: false, isMac: false, canControl: false, autoBuy: false }),
    ).toEqual({ enabled: false, checked: false, note: 'searches.buyWebOnly' });
  });

  it('non-mac desktop → disabled, off, unsupported-OS note', () => {
    expect(
      resolveBuyControl({ isDesktop: true, isMac: false, canControl: true, autoBuy: true }),
    ).toEqual({ enabled: false, checked: false, note: 'searches.buyUnsupportedOs' });
  });

  it('macOS desktop without control → disabled + off even when autoBuy persisted (revoked, #2=B)', () => {
    expect(resolveBuyControl({ ...MAC_DESKTOP, canControl: false, autoBuy: true })).toEqual({
      enabled: false,
      checked: false,
      note: 'searches.buyNeedsPermission',
    });
  });

  it('macOS desktop with control → live toggle reflecting autoBuy', () => {
    expect(resolveBuyControl({ ...MAC_DESKTOP, canControl: true, autoBuy: true })).toEqual({
      enabled: true,
      checked: true,
      note: null,
    });
    expect(resolveBuyControl({ ...MAC_DESKTOP, canControl: true, autoBuy: false })).toEqual({
      enabled: true,
      checked: false,
      note: null,
    });
  });
});
