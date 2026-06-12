import { useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, LogIn, X } from 'lucide-react';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { IconButton } from '../components/IconButton';
import { useLoginCapture } from '../hooks/useLoginCapture';
import { useT } from '../i18n/i18n';

interface LoginOverlayProps {
  /** true = stored cookies failed the probe; false = no session at all. */
  expired: boolean;
  onRefresh: () => void;
  onClose: () => void;
}

/** Blocking-but-dismissible prompt shown on boot when the app can't snipe. */
export function LoginOverlay({ expired, onRefresh, onClose }: LoginOverlayProps) {
  const t = useT();
  const { loginState, loginDetail, start, cancel } = useLoginCapture(onRefresh);
  const [busy] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-0/80 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-lg border border-edge bg-surface-1 p-6 shadow-2xl">
        <IconButton
          variant="ghost"
          aria-label={t('common.close')}
          className="absolute top-3 right-3"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </IconButton>

        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-gold" />
          <h2 className="text-base font-semibold text-ink">
            {expired ? t('login.titleExpired') : t('login.titleMissing')}
          </h2>
        </div>
        <p className="mt-2 text-sm text-ink-muted">
          {expired ? t('login.bodyExpired') : t('login.bodyMissing')}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            disabled={busy || loginState === 'waiting-login'}
            onClick={start}
          >
            <LogIn className="h-4 w-4" />
            {expired ? t('login.again') : t('login.withPoe')}
          </Button>
          {loginState === 'waiting-login' && (
            <>
              <Badge tone="gold">{t('login.waiting')}</Badge>
              <Button variant="ghost" onClick={cancel}>
                {t('common.cancel')}
              </Button>
            </>
          )}
        </div>
        {loginDetail && <p className="mt-2 text-xs text-ink-faint">{loginDetail}</p>}
        <p className="mt-3 text-xs text-ink-faint">
          {t('login.preferNot')}{' '}
          <Link
            className="text-gold underline-offset-2 hover:underline"
            to="/settings"
            onClick={onClose}
          >
            {t('login.pasteInSettings')}
          </Link>
        </p>
      </div>
    </div>
  );
}
