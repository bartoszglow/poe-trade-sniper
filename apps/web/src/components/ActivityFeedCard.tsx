import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Coins,
  ExternalLink,
  ShoppingCart,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { ActivityOutcome, ActivityStep } from '@poe-sniper/shared';
import { useT } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';
import { formatRelativeMagnitude } from '../lib/relative-time';
import type { FeedEntry, FeedKind } from '../hooks/useActivityFeed';
import { Badge, type BadgeTone } from './Badge';
import { ItemDetailView } from './ItemDetailView';
import { PriceCheckResultView } from './PriceCheckResultView';
import { PriceTag } from './PriceTag';
import { RarityName } from './RarityName';

/** Per-kind icon + accent bar (open/closed — a new event kind = a new entry). */
const KIND: Record<FeedKind, { icon: LucideIcon; accent: string }> = {
  hit: { icon: Zap, accent: 'bg-gold' },
  'price-check': { icon: Coins, accent: 'bg-info' },
  activity: { icon: ShoppingCart, accent: 'bg-ok' },
};

/** Auto-buy headline outcome → label + tone (folded in from the old ActivityCard). */
const OUTCOME: Record<ActivityOutcome, { key: MessageKey; tone: BadgeTone }> = {
  'in-progress': { key: 'activity.outcome.inProgress', tone: 'gold' },
  'travel-failed': { key: 'activity.outcome.travelFailed', tone: 'danger' },
  'no-shop': { key: 'activity.outcome.noShop', tone: 'danger' },
  'item-sold': { key: 'activity.outcome.itemSold', tone: 'danger' },
  placed: { key: 'activity.outcome.placed', tone: 'ok' },
  aborted: { key: 'activity.outcome.aborted', tone: 'neutral' },
  unsupported: { key: 'activity.outcome.unsupported', tone: 'neutral' },
  failed: { key: 'activity.outcome.failed', tone: 'danger' },
};

const FAILURE_OUTCOMES = new Set<ActivityOutcome>([
  'travel-failed',
  'no-shop',
  'item-sold',
  'failed',
]);

function stepTone(phase: string): string {
  if (phase === 'success' || phase === 'moved' || phase === 'returned') return 'text-ok';
  if (phase === 'failed' || phase === 'return-failed') return 'text-danger';
  if (phase === 'aborted' || phase === 'unsupported') return 'text-ink-faint';
  return 'text-gold';
}

interface ActivityFeedCardProps {
  entry: FeedEntry;
  nowMs: number;
  /** Source-search label for the chip, or null when the search is gone / N/A. */
  searchLabel: string | null;
  /** Trade-site page URL for the source search, or null when unresolvable. */
  tradeUrl: string | null;
  /** Spotlight the source search on the Searches view. */
  onLocateSearch: () => void;
}

/**
 * One card in the unified Activity feed (#39). Shared shell (the Searches card
 * language) + a left kind-accent; a summary row that expands to the event/action
 * details (level 1), which in turn can reveal the item's mods (level 2). Per-kind
 * bodies reuse the existing atoms (PriceTag, PriceCheckResultView, ItemDetailView).
 */
export function ActivityFeedCard({
  entry,
  nowMs,
  searchLabel,
  tradeUrl,
  onLocateSearch,
}: ActivityFeedCardProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [itemOpen, setItemOpen] = useState(false);

  const Icon = KIND[entry.kind].icon;
  const failed = entry.kind === 'activity' && FAILURE_OUTCOMES.has(entry.record.outcome);
  const accent = failed ? 'bg-danger' : KIND[entry.kind].accent;
  const item =
    entry.kind === 'hit' ? entry.hit.item : entry.kind === 'activity' ? entry.record.item : null;
  const at =
    entry.kind === 'hit'
      ? entry.hit.detectedAt
      : entry.kind === 'activity'
        ? entry.record.startedAt
        : new Date(entry.atMs).toISOString();

  return (
    <li className="relative overflow-hidden rounded-lg border border-edge bg-surface-1">
      <div className={`absolute top-0 bottom-0 left-0 w-[3px] ${accent}`} />
      <div className="flex items-start gap-3 py-2.5 pr-4 pl-5">
        <span className="mt-0.5 grid h-5 w-5 flex-none place-items-center rounded border border-edge bg-surface-3 text-ink-muted">
          <Icon className="h-3 w-3" />
        </span>
        <div className="min-w-0 flex-1">
          {/* Summary row — clicking toggles level 1 (the chevron button below covers
              keyboard); the chip/link stop propagation. */}
          <div
            className="flex cursor-pointer items-center gap-2"
            onClick={() => setExpanded((v) => !v)}
          >
            {renderSummary()}
            <button
              type="button"
              aria-label={expanded ? t('common.collapse') : t('common.expand')}
              aria-expanded={expanded}
              className="flex-none text-ink-faint hover:text-ink"
              onClick={(clickEvent) => {
                clickEvent.stopPropagation();
                setExpanded((v) => !v);
              }}
            >
              {expanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          </div>

          {expanded && <div className="mt-2 border-t border-edge pt-2">{renderDetails()}</div>}
        </div>
      </div>
    </li>
  );

  function timeChip() {
    return (
      <span
        className="font-mono text-[0.65rem] text-ink-faint"
        title={new Date(at).toLocaleString()}
      >
        {t('common.ago', { value: formatRelativeMagnitude(at, nowMs) })}
      </span>
    );
  }

  function sourceChip() {
    if (searchLabel === null) return null;
    return (
      <button
        type="button"
        title={searchLabel}
        aria-label={t('hitCard.locateSearch')}
        onClick={(clickEvent) => {
          clickEvent.stopPropagation();
          onLocateSearch();
        }}
        className="max-w-36 min-w-12 shrink truncate rounded bg-surface-3 px-1.5 py-0.5 text-[0.6rem] text-ink-muted transition-colors hover:text-gold"
      >
        {searchLabel}
      </button>
    );
  }

  function renderSummary() {
    if (entry.kind === 'hit') {
      return (
        <>
          <RarityName name={entry.hit.itemName} rarity={entry.hit.item?.rarity ?? null} />
          <div className="flex-1" />
          <PriceTag price={entry.hit.price} />
          {sourceChip()}
          {timeChip()}
        </>
      );
    }
    if (entry.kind === 'activity') {
      const outcome = OUTCOME[entry.record.outcome] ?? OUTCOME['in-progress'];
      return (
        <>
          <RarityName name={entry.record.itemName} rarity={entry.record.item?.rarity ?? null} />
          <Badge tone={outcome.tone}>{t(outcome.key)}</Badge>
          <div className="flex-1" />
          {sourceChip()}
          {timeChip()}
        </>
      );
    }
    const result = entry.entry.result;
    return (
      <>
        <RarityName
          name={result.item.name ?? result.item.baseType ?? t('priceCheck.unknownItem')}
          rarity={result.item.rarity}
        />
        <div className="flex-1" />
        {result.kind === 'aggregate' && result.estimate && (
          <span className="text-xs text-ink-muted">
            {t('priceCheck.estimate')} <PriceTag price={result.estimate} />
          </span>
        )}
        {result.kind === 'listings' && result.listings[0]?.price && (
          <span className="text-xs text-ink-muted">
            {t('activity.cheapest')} <PriceTag price={result.listings[0].price} />
          </span>
        )}
        {timeChip()}
      </>
    );
  }

  function renderDetails() {
    if (entry.kind === 'price-check') {
      return <PriceCheckResultView result={entry.entry.result} maxListings={5} />;
    }
    if (entry.kind === 'hit') {
      return (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
            {entry.hit.seller && (
              <span>
                {t('activity.seller')} <span className="text-ink">{entry.hit.seller}</span>
              </span>
            )}
            <span>
              {t('activity.listed')} <PriceTag price={entry.hit.price} />
            </span>
            {tradeUrl && (
              <a
                href={tradeUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-ink-muted hover:text-ink"
              >
                <ExternalLink className="h-3 w-3" />
                {t('searches.openOnTradeSite')}
              </a>
            )}
          </div>
          {itemDetailToggle()}
        </div>
      );
    }
    // activity — left column = the action (data + step timeline); right column = the
    // item, shown immediately (no second toggle). Two columns on wide screens fill the
    // width; they stack below `lg`. No item → the action spans the full width.
    const record = entry.record;
    const actionColumn = (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
          <span>
            {t('activity.listed')} <PriceTag price={record.price} />
          </span>
          {record.seller && (
            <span>
              {t('activity.seller')} <span className="text-ink">{record.seller}</span>
            </span>
          )}
          <Badge tone="neutral">{record.source}</Badge>
          {record.returnedHome !== null && (
            <span className={record.returnedHome ? 'text-ok' : 'text-danger'}>
              {record.returnedHome ? `⌂ ${t('activity.home')}` : `⌂ ${t('activity.notHome')}`}
            </span>
          )}
        </div>
        <ul className="flex flex-col gap-0.5 border-l border-edge pl-2">
          {record.steps.map((step: ActivityStep, index) => (
            <li key={index} className="flex items-baseline gap-2 text-xs">
              <span className="w-12 shrink-0 text-ink-faint">{step.kind}</span>
              <span className={stepTone(step.phase)}>{step.phase}</span>
              {step.detail && <span className="truncate text-ink-faint">{step.detail}</span>}
              <div className="flex-1" />
              <span className="font-mono text-[0.6rem] text-ink-faint/70">
                {new Date(step.at).toLocaleTimeString()}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
    if (!record.item) return actionColumn;
    return (
      <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        {actionColumn}
        <ItemDetailView item={record.item} columns="single" />
      </div>
    );
  }

  function itemDetailToggle() {
    if (!item) return null;
    return (
      <div>
        <button
          type="button"
          aria-expanded={itemOpen}
          onClick={() => setItemOpen((value) => !value)}
          className="flex items-center gap-1 text-xs text-gold hover:text-gold-bright"
        >
          {itemOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {t('activity.details')}
        </button>
        {itemOpen && (
          <div className="mt-2">
            <ItemDetailView item={item} />
          </div>
        )}
      </div>
    );
  }
}
