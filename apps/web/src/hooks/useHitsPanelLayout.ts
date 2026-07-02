import { useEffect, useState } from 'react';
import {
  readHitsPanelLayout,
  subscribeHitsPanelLayout,
  type HitsPanelLayout,
} from '../lib/hits-panel-layout';

/** Live view of the Live Hits panel layout prefs (width + hidden), see #34. */
export function useHitsPanelLayout(): HitsPanelLayout {
  const [layout, setLayout] = useState<HitsPanelLayout>(readHitsPanelLayout);
  useEffect(() => subscribeHitsPanelLayout(() => setLayout(readHitsPanelLayout())), []);
  return layout;
}
