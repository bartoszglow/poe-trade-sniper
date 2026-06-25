import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ActivityOutcome, ActivityRecord, ActivityStep } from '@poe-sniper/shared';
import { useT } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';
import { formatRelativeMagnitude } from '../lib/relative-time';
import { Badge, type BadgeTone } from './Badge';
import { ItemDetailView } from './ItemDetailView';
import { PriceTag } from './PriceTag';
import { RarityName } from './RarityName';

/** Headline outcome → label + badge tone. */
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

/** Per-step colour: success/done green, failures red, terminal-neutral faint, else gold. */
function stepTone(phase: string): string {
  if (phase === 'success' || phase === 'moved' || phase === 'returned') return 'text-ok';
  if (phase === 'failed' || phase === 'return-failed') return 'text-danger';
  if (phase === 'aborted' || phase === 'unsupported') return 'text-ink-faint';
  return 'text-gold';
}

export function ActivityCard({ activity, nowMs }: { activity: ActivityRecord; nowMs: number }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const outcome = OUTCOME[activity.outcome] ?? OUTCOME['in-progress'];

  return (
    <div className="rounded-md border border-edge bg-surface-2 px-3 py-2">
      <div className="flex items-baseline gap-2">
        <span
          className="font-mono text-[0.65rem] text-ink-faint"
          title={new Date(activity.startedAt).toLocaleString()}
        >
          {t('common.ago', { value: formatRelativeMagnitude(activity.startedAt, nowMs) })}
        </span>
        <RarityName name={activity.itemName} rarity={activity.item?.rarity ?? null} />
        <div className="flex-1" />
        <Badge tone={outcome.tone}>{t(outcome.key)}</Badge>
      </div>

      <div className="mt-1 flex items-center gap-2">
        <PriceTag price={activity.price} />
        {activity.seller && (
          <span className="truncate text-xs text-ink-faint">{activity.seller}</span>
        )}
        <div className="flex-1" />
        <Badge tone="neutral">{activity.source}</Badge>
        {activity.returnedHome !== null && (
          <span
            className={`text-xs ${activity.returnedHome ? 'text-ok' : 'text-danger'}`}
            title={t('activity.returnedHome')}
          >
            {activity.returnedHome ? `⌂ ${t('activity.home')}` : `⌂ ${t('activity.notHome')}`}
          </span>
        )}
      </div>

      <ul className="mt-2 flex flex-col gap-0.5 border-l border-edge pl-2">
        {activity.steps.map((step: ActivityStep, index) => (
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

      {activity.item && (
        <>
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className="mt-2 flex items-center gap-1 text-xs text-ink-faint hover:text-ink"
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {t('activity.details')}
          </button>
          {expanded && (
            <div className="mt-2">
              <ItemDetailView item={activity.item} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
