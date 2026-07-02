import { useEffect, useState } from 'react';

/** Tailwind's `lg` breakpoint — the app's single structural threshold (the
 *  Live Hits panel and its AppBar toggle exist only at or above it). */
const DESKTOP_WIDTH_QUERY = '(min-width: 1024px)';

/** Live `lg`-breakpoint check — media query, never user-agent sniffing (#36). */
export function useIsDesktopWidth(): boolean {
  const [isDesktopWidth, setIsDesktopWidth] = useState(
    () => window.matchMedia(DESKTOP_WIDTH_QUERY).matches,
  );
  useEffect(() => {
    const mediaQuery = window.matchMedia(DESKTOP_WIDTH_QUERY);
    const onChange = () => setIsDesktopWidth(mediaQuery.matches);
    mediaQuery.addEventListener('change', onChange);
    return () => mediaQuery.removeEventListener('change', onChange);
  }, []);
  return isDesktopWidth;
}
