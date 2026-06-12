import { ArrowDownToLine } from 'lucide-react';
import type { UpdateStatus } from '@poe-sniper/shared';
import { useT } from '../i18n/i18n';

/**
 * Shown when a newer release exists. A lightweight check only — the link opens
 * the download in the browser (Electron forwards http(s) to the real browser);
 * there is no silent install (that needs a signed build).
 */
export function UpdateBanner({ update }: { update: UpdateStatus }) {
  const t = useT();
  const href = update.downloadUrl ?? update.releaseUrl;
  if (!href) return null;
  return (
    <div className="flex items-center gap-3 border-b border-info/40 bg-info/15 px-4 py-2 text-sm">
      <ArrowDownToLine className="h-4 w-4 shrink-0 text-info" />
      <span className="text-ink">
        {t('update.available', { version: update.latestVersion ?? '' })}
      </span>
      <div className="flex-1" />
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-sm text-info underline-offset-2 hover:underline"
      >
        {t('update.download')}
      </a>
    </div>
  );
}
