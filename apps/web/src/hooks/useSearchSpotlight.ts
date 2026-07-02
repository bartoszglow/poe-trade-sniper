import { useEffect, useState } from 'react';
import {
  readSearchSpotlight,
  subscribeSearchSpotlight,
  type SearchSpotlight,
} from '../lib/search-spotlight';

/** Live view of the click-to-locate spotlight (one slot; see search-spotlight.ts). */
export function useSearchSpotlight(): SearchSpotlight | null {
  const [spotlight, setSpotlight] = useState<SearchSpotlight | null>(readSearchSpotlight);
  useEffect(() => subscribeSearchSpotlight(() => setSpotlight(readSearchSpotlight())), []);
  return spotlight;
}
