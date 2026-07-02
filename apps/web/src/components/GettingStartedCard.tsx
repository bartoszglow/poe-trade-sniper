import { Check, X } from 'lucide-react';
import type { GettingStartedProgress } from '../lib/getting-started';
import { useT } from '../i18n/i18n';
import { IconButton } from './IconButton';

function ChecklistItem({
  done,
  label,
  trailing,
}: {
  done: boolean;
  label: string;
  trailing?: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-2.5 border-b border-edge py-2 text-sm last:border-b-0">
      <span
        className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border text-[10px] ${
          done ? 'border-ok bg-ok/20 text-ok' : 'border-edge-strong text-transparent'
        }`}
      >
        <Check className="h-3 w-3" />
      </span>
      <span className={done ? 'text-ink-faint line-through' : 'text-ink'}>{label}</span>
      {trailing !== undefined && <span className="ml-auto text-xs">{trailing}</span>}
    </li>
  );
}

/**
 * "Getting started" checklist (#36, D-onb-2): the real first-run funnel,
 * derived from live state. Renders on the Searches view until the funnel
 * completes or the operator dismisses it (persisted per-device).
 */
export function GettingStartedCard({
  progress,
  onDismiss,
}: {
  progress: GettingStartedProgress;
  onDismiss: () => void;
}) {
  const t = useT();
  return (
    <div className="rounded-lg border border-edge bg-surface-1 px-4 py-3">
      <div className="flex items-center">
        <h2 className="text-xs font-semibold tracking-widest text-ink-muted uppercase">
          {t('gettingStarted.title')}
        </h2>
        <div className="flex-1" />
        <IconButton variant="ghost" aria-label={t('common.close')} onClick={onDismiss}>
          <X className="h-3.5 w-3.5" />
        </IconButton>
      </div>
      <ul>
        <ChecklistItem done={progress.sessionConnected} label={t('gettingStarted.stepSession')} />
        <ChecklistItem
          done={progress.firstSearchAdded}
          label={t('gettingStarted.stepSearch')}
          trailing={
            progress.firstSearchAdded ? undefined : (
              <span className="text-gold">{t('gettingStarted.stepSearchCta')}</span>
            )
          }
        />
        <ChecklistItem
          done={progress.firstHitReceived}
          label={t('gettingStarted.stepHit')}
          trailing={
            progress.firstHitReceived || !progress.firstSearchAdded ? undefined : (
              <span className="text-ink-faint">{t('gettingStarted.stepHitPending')}</span>
            )
          }
        />
      </ul>
    </div>
  );
}
