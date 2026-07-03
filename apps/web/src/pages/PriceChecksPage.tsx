import { useEffect, useState } from 'react';
import { Coins, Eraser } from 'lucide-react';
import type { PriceCheckDraft } from '@poe-sniper/shared';
import { Button } from '../components/Button';
import { PriceCheckEditor } from '../components/PriceCheckEditor';
import { PriceCheckResultView } from '../components/PriceCheckResultView';
import { usePriceCheck } from '../hooks/usePriceCheck';
import { useT } from '../i18n/i18n';
import { formatRelativeMagnitude } from '../lib/relative-time';

/** Re-render cadence for the relative "x ago" timestamps. */
const TICK_MS = 5_000;

/**
 * Price Checks view (#37/#38): paste an item → an editable draft (pick which
 * stats/attributes to price and tweak their values) → price it. The recent-checks
 * history (durable, newest first) sits below. A desktop hotkey still lands its
 * one-shot result straight in the history.
 */
export function PriceChecksPage() {
  const t = useT();
  const { history, checking, error, parse, priceDraft, clearHistory } = usePriceCheck();
  const [pasteText, setPasteText] = useState('');
  const [draft, setDraft] = useState<PriceCheckDraft | null>(null);
  const [parsing, setParsing] = useState(false);

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  async function runParse(): Promise<void> {
    setParsing(true);
    const next = await parse(pasteText);
    setParsing(false);
    if (next) setDraft(next);
  }

  async function runPrice(): Promise<void> {
    if (!draft) return;
    // Only clear on success — a transient failure keeps the edited draft + source
    // text so the operator can retry without redoing every filter edit.
    const priced = await priceDraft(draft);
    if (priced) {
      setDraft(null);
      setPasteText('');
    }
  }

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-ink">
          <Coins className="h-5 w-5 text-gold" />
          {t('priceChecks.title')}
        </h1>
        {history.length > 0 && (
          <Button variant="ghost" onClick={clearHistory}>
            <Eraser className="h-4 w-4" />
            {t('priceChecks.clearHistory')}
          </Button>
        )}
      </div>

      <div className="rounded-lg border border-edge bg-surface-1 p-4">
        <p className="text-sm text-ink-muted">{t('priceChecks.pasteHint')}</p>
        <textarea
          value={pasteText}
          onChange={(changeEvent) => setPasteText(changeEvent.target.value)}
          rows={5}
          placeholder={t('priceChecks.pastePlaceholder')}
          className="mt-3 w-full rounded-md border border-edge bg-surface-2 px-2.5 py-1.5 font-mono text-xs text-ink placeholder:text-ink-faint focus:border-gold focus:outline-none"
        />
        <div className="mt-2 flex items-center gap-3">
          <Button
            variant="primary"
            disabled={parsing || pasteText.trim() === ''}
            onClick={() => void runParse()}
          >
            {parsing ? t('priceCheck.checking') : t('priceChecks.parseEdit')}
          </Button>
          {error && <span className="text-sm text-danger">{t('common.requestFailed')}</span>}
        </div>
      </div>

      {draft && (
        <PriceCheckEditor
          draft={draft}
          onChange={setDraft}
          onPrice={() => void runPrice()}
          pricing={checking}
        />
      )}

      {history.length === 0 ? (
        <p className="text-sm text-ink-faint">{t('priceChecks.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {history.map((entry) => (
            <li key={entry.id} className="rounded-lg border border-edge bg-surface-1 px-4 py-3">
              <div className="mb-1.5 text-[0.65rem] text-ink-faint">
                {t('common.ago', {
                  value: formatRelativeMagnitude(new Date(entry.at).toISOString(), nowMs),
                })}
              </div>
              <PriceCheckResultView result={entry.result} maxListings={5} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
