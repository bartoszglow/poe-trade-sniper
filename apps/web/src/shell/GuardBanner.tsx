import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Button } from '../components/Button';
import { useT } from '../i18n/i18n';
import { apiSend } from '../lib/api';

interface GuardBannerProps {
  onReset: () => void;
}

/**
 * Full-width alarm strip shown while the outbound safety guard is tripped —
 * detection and travel are halted until the operator investigates and resets.
 * The raw trip reason (a technical rate string with a URL) is deliberately NOT
 * shown — it lives in the logs / dev Network view; the operator sees a localized
 * explanation instead (hard rule: never surface raw technical strings).
 */
export function GuardBanner({ onReset }: GuardBannerProps) {
  const t = useT();
  const [resetting, setResetting] = useState(false);

  return (
    <div
      role="alert"
      className="flex items-center gap-3 border-b border-danger/40 bg-danger/15 px-4 py-2"
    >
      <ShieldAlert className="h-4 w-4 shrink-0 text-danger" />
      <div className="min-w-0 text-sm">
        <span className="font-semibold text-danger">{t('guard.tripped')}</span>{' '}
        <span className="text-ink-muted">{t('guard.trippedHelp')}</span>
      </div>
      <div className="flex-1" />
      <Button
        variant="danger"
        disabled={resetting}
        onClick={() => {
          setResetting(true);
          void apiSend('POST', '/api/guard/reset')
            .catch(() => undefined)
            .finally(() => {
              setResetting(false);
              onReset();
            });
        }}
      >
        {t('guard.reset')}
      </Button>
    </div>
  );
}
