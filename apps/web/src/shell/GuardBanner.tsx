import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Button } from '../components/Button';
import { apiSend } from '../lib/api';

interface GuardBannerProps {
  reason: string | null;
  onReset: () => void;
}

/**
 * Full-width alarm strip shown while the outbound safety guard is tripped —
 * detection and travel are halted until the operator investigates and resets.
 */
export function GuardBanner({ reason, onReset }: GuardBannerProps) {
  const [resetting, setResetting] = useState(false);

  return (
    <div className="flex items-center gap-3 border-b border-danger/40 bg-danger/15 px-4 py-2">
      <ShieldAlert className="h-4 w-4 shrink-0 text-danger" />
      <div className="min-w-0 text-sm">
        <span className="font-semibold text-danger">
          Safety guard tripped — all PoE traffic halted.
        </span>{' '}
        <span className="text-ink-muted">{reason ?? 'unknown reason'}</span>
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
        Reset guard
      </Button>
    </div>
  );
}
