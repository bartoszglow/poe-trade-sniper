import { describe, expect, it } from 'vitest';
import {
  HITS_PANEL_MAX_WIDTH_PX,
  HITS_PANEL_MIN_WIDTH_PX,
  clampHitsPanelWidth,
} from './hits-panel-layout';

describe('clampHitsPanelWidth', () => {
  it('passes a width inside the band through (rounded)', () => {
    expect(clampHitsPanelWidth(500.6, 1920)).toBe(501);
  });

  it('clamps to the fixed min and max on a wide viewport', () => {
    expect(clampHitsPanelWidth(10, 1920)).toBe(HITS_PANEL_MIN_WIDTH_PX);
    expect(clampHitsPanelWidth(5000, 1920)).toBe(HITS_PANEL_MAX_WIDTH_PX);
  });

  it('caps by the viewport fraction on a narrow screen (middle content survives)', () => {
    // 1024px viewport → 45% cap = 460px, below the fixed max.
    expect(clampHitsPanelWidth(700, 1024)).toBe(460);
  });

  it('never caps below the fixed minimum, even on a tiny viewport', () => {
    expect(clampHitsPanelWidth(700, 500)).toBe(HITS_PANEL_MIN_WIDTH_PX);
  });
});
