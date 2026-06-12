import { useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, LogIn, X } from 'lucide-react';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { IconButton } from '../components/IconButton';
import { useLoginCapture } from '../hooks/useLoginCapture';

interface LoginOverlayProps {
  /** true = stored cookies failed the probe; false = no session at all. */
  expired: boolean;
  onRefresh: () => void;
  onClose: () => void;
}

/** Blocking-but-dismissible prompt shown on boot when the app can't snipe. */
export function LoginOverlay({ expired, onRefresh, onClose }: LoginOverlayProps) {
  const { loginState, loginDetail, start, cancel } = useLoginCapture(onRefresh);
  const [busy] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-0/80 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-lg border border-edge bg-surface-1 p-6 shadow-2xl">
        <IconButton
          variant="ghost"
          aria-label="Close"
          className="absolute top-3 right-3"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </IconButton>

        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-gold" />
          <h2 className="text-base font-semibold text-ink">
            {expired ? 'Your PoE session expired' : 'Not logged in to Path of Exile'}
          </h2>
        </div>
        <p className="mt-2 text-sm text-ink-muted">
          {expired
            ? 'The stored cookies no longer work — detection and travel are paused until you log in again.'
            : 'The sniper needs a PoE session to watch searches and travel. Log in once and you are set.'}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            disabled={busy || loginState === 'waiting-login'}
            onClick={start}
          >
            <LogIn className="h-4 w-4" />
            {expired ? 'Log in again' : 'Log in with Path of Exile'}
          </Button>
          {loginState === 'waiting-login' && (
            <>
              <Badge tone="gold">waiting for login…</Badge>
              <Button variant="ghost" onClick={cancel}>
                Cancel
              </Button>
            </>
          )}
        </div>
        {loginDetail && <p className="mt-2 text-xs text-ink-faint">{loginDetail}</p>}
        <p className="mt-3 text-xs text-ink-faint">
          Prefer not to log in here?{' '}
          <Link
            className="text-gold underline-offset-2 hover:underline"
            to="/settings"
            onClick={onClose}
          >
            Paste cookies in Settings
          </Link>
        </p>
      </div>
    </div>
  );
}
