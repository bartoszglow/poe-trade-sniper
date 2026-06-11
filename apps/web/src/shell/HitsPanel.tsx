import { Zap } from 'lucide-react';
import { Badge } from '../components/Badge';

/**
 * Persistent live-hits panel — always visible on lg+ viewports so a hit is
 * never hidden behind navigation. Receives the SSE feed in Phase 3; until
 * then it renders the empty state.
 */
export function HitsPanel() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-edge px-4 py-2.5">
        <Zap className="h-3.5 w-3.5 text-gold" />
        <span className="text-xs font-semibold tracking-widest text-ink-muted uppercase">
          Live hits
        </span>
        <div className="flex-1" />
        <Badge tone="neutral">phase 3</Badge>
      </div>
      <div className="flex flex-1 items-center justify-center px-6 text-center">
        <p className="text-sm text-ink-faint">
          Detected listings will stream here in real time once the detection engines land.
        </p>
      </div>
    </div>
  );
}
