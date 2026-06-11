import { Plus } from 'lucide-react';
import { Button } from '../components/Button';

export function SearchesPage() {
  return (
    <section>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-ink">Searches</h1>
        <Button variant="primary" disabled title="Search management lands in Phase 1">
          <Plus className="h-4 w-4" />
          Add search
        </Button>
      </div>
      <p className="mt-6 text-sm text-ink-faint">
        Watched trade searches appear here — engine status, shared rate-limit budget and per-search
        AUTO travel. Arrives with the detection core (Phase 1).
      </p>
    </section>
  );
}
