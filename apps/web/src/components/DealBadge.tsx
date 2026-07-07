import type { DealHitInfo } from '@poe-sniper/shared';
import { useT } from '../i18n/i18n';
import { formatDealDiscount } from '../lib/deal-display';
import { Badge } from './Badge';

interface DealBadgeProps {
  deal: DealHitInfo;
}

/**
 * Discount chip for deal-mode hits (plan 41): '−32%' in gold, with a warn
 * 'stale' marker when the baseline aged out (alerts keep firing, flagged —
 * plan 41 failure modes). A deal persisted before the first baseline landed
 * shows a small muted marker (not a full badge) instead of a discount.
 */
export function DealBadge({ deal }: DealBadgeProps) {
  const t = useT();
  const discount = formatDealDiscount(deal);
  if (discount === null) {
    // No baseline yet — a subtle inline marker, not a heavy filled tag; the full
    // reason lives in the tooltip so the row stays uncluttered.
    return (
      <span
        className="shrink-0 text-[0.6rem] font-medium tracking-wide text-ink-muted uppercase"
        title={t('deal.badgePendingHint')}
      >
        {t('deal.badgePending')}
      </span>
    );
  }
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1"
      title={deal.baselineStale ? t('dealWatch.status.baseline-stale') : undefined}
    >
      <Badge tone="gold">{discount}</Badge>
      {deal.baselineStale && (
        <span className="text-[0.6rem] font-medium tracking-wide text-warn uppercase">
          {t('deal.stale')}
        </span>
      )}
    </span>
  );
}
