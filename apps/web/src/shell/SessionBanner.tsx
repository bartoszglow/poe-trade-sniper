import { Link } from 'react-router-dom';
import { KeyRound } from 'lucide-react';

/** Shown when the stored session failed the login probe — engines are blind. */
export function SessionBanner() {
  return (
    <div className="flex items-center gap-3 border-b border-warn/40 bg-warn/15 px-4 py-2 text-sm">
      <KeyRound className="h-4 w-4 shrink-0 text-warn" />
      <span className="text-warn">
        PoE session looks expired — detection cannot reach the trade API.
      </span>
      <div className="flex-1" />
      <Link to="/settings" className="text-sm text-gold underline-offset-2 hover:underline">
        Fix in Settings
      </Link>
    </div>
  );
}
