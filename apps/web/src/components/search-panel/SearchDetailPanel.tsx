import { useEffect, useRef, useState } from 'react';
import type { SearchRuntimeInfo } from '@poe-sniper/shared';
import type { UpdateSearchPayload } from '../../hooks/useSearches';
import type { BuyControl } from '../../lib/resolve-buy-control';
import { AutomationCard } from './AutomationCard';
import { DealHistoryCard } from './DealHistoryCard';
import { DealPriceCard } from './DealPriceCard';
import { ItemCard } from './ItemCard';
import { SettingsCard } from './SettingsCard';

/** A section the panel can be asked to bring into view when it opens. */
export type PanelSection = 'deal' | 'settings';

/** Scroll request: a fresh token re-fires the scroll even for the same section. */
export interface PanelScrollTarget {
  section: PanelSection;
  token: number;
}

interface SearchDetailPanelProps {
  search: SearchRuntimeInfo;
  detectionPaused: boolean;
  /** Buy-switch gating resolved at page level (permission/platform notes). */
  buyControl: BuyControl;
  onUpdate: (payload: UpdateSearchPayload) => Promise<void>;
  /** Delete this row (the settings card owns the confirm + action now). */
  onRemove: () => Promise<void>;
  /** Manual detection restart (plan 43, D-deg-4). */
  onRestart: () => Promise<void>;
  /** Set when the panel was opened via the DEAL chip / pencil / locate (Q3). */
  scrollTarget: PanelScrollTarget | null;
}

/**
 * The unified per-search detail panel (plan 42): one expandable view replacing
 * the criteria-only expansion and both popups. Desktop: item | deal side by
 * side, history + settings full-width below; mobile stacks actionable-first
 * (deal, history, item, settings) via CSS order. Owns the shared 1s clock
 * (cooldown countdown + relative times age together) and the history reload
 * token the deal card bumps after a save / manual refresh.
 */
export function SearchDetailPanel({
  search,
  detectionPaused,
  buyControl,
  onUpdate,
  onRemove,
  onRestart,
  scrollTarget,
}: SearchDetailPanelProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [historyReloadToken, setHistoryReloadToken] = useState(0);
  const dealRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (scrollTarget === null) return undefined;
    // Wait out the ~200ms expand animation (D-42-1) so the section's final
    // position exists before scrolling; 'nearest' keeps this gentle next to
    // the page's own row centering (Q3). Respect reduced-motion — the panel
    // itself does not animate then, so the scroll must not either.
    const timer = setTimeout(() => {
      const target = scrollTarget.section === 'deal' ? dealRef.current : settingsRef.current;
      const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'nearest' });
    }, 260);
    return () => clearTimeout(timer);
  }, [scrollTarget]);

  // DOM order is the mobile reading/tab order — actionable-first
  // (deal → history → automation → item → settings). Desktop uses explicit
  // grid placement (lg:col-start/row-start): left column = automation then
  // item, right column = deal spanning both rows, then history + settings full
  // width. Keeping keyboard/AT order natural on mobile (WCAG 2.4.3).
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <div
        ref={dealRef}
        className="min-w-0 lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:self-start"
      >
        <DealPriceCard
          search={search}
          detectionPaused={detectionPaused}
          nowMs={nowMs}
          onUpdate={onUpdate}
          onHistoryStale={() => setHistoryReloadToken((token) => token + 1)}
        />
      </div>
      <div className="min-w-0 lg:col-span-2 lg:col-start-1 lg:row-start-3">
        <DealHistoryCard search={search} nowMs={nowMs} reloadToken={historyReloadToken} />
      </div>
      <div className="min-w-0 lg:col-start-1 lg:row-start-1">
        <AutomationCard
          search={search}
          detectionPaused={detectionPaused}
          buyControl={buyControl}
          onUpdate={onUpdate}
        />
      </div>
      <div className="min-w-0 lg:col-start-1 lg:row-start-2">
        <ItemCard search={search} />
      </div>
      <div ref={settingsRef} className="min-w-0 lg:col-span-2 lg:col-start-1 lg:row-start-4">
        <SettingsCard
          search={search}
          onUpdate={onUpdate}
          onRemove={onRemove}
          onRestart={onRestart}
        />
      </div>
    </div>
  );
}
