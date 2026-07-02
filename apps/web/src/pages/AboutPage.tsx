import { GraduationCap, HandHeart } from 'lucide-react';
import { Button } from '../components/Button';
import { useHealth } from '../hooks/useHealth';
import { useT } from '../i18n/i18n';
import { setOnboardingDone } from '../lib/onboarding';
import {
  AUTHOR_LINKS,
  AUTHOR_NAME,
  DONATION_LINKS,
  PROJECT_LINKS,
  hasAnySupportLink,
  type SupportLink,
} from '../config/support';

/** Two-letter monogram fallback for the author avatar. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/** An external link styled as a button; opens in the real browser via the shell's
 *  window-open handler. `primary` highlights the recommended action. */
function SupportButton({ link, primary = false }: { link: SupportLink; primary?: boolean }) {
  const t = useT();
  const label = link.labelKey ? t(link.labelKey) : (link.label ?? '');
  const Icon = link.icon;
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors ${
        primary
          ? 'border-gold/40 bg-gold/10 text-gold-bright hover:bg-gold/20'
          : 'border-edge bg-surface-2 text-ink hover:border-edge-strong hover:text-gold-bright'
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </a>
  );
}

/** About & Support — author, donations and project links. All external targets live in
 *  the central `config/support.ts`; a link with no url yet is simply not shown. */
export function AboutPage() {
  const t = useT();
  const { version } = useHealth();
  const authorLinks = AUTHOR_LINKS.filter((link) => link.url !== '');
  const donations = DONATION_LINKS.filter((link) => link.url !== '');
  const projectLinks = PROJECT_LINKS.filter((link) => link.url !== '');

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header>
        <div className="flex items-baseline gap-2">
          <h1 className="font-mono text-lg font-semibold tracking-wide text-gold">
            PoE Trade Sniper
          </h1>
          {version && <span className="text-xs text-ink-faint">v{version}</span>}
        </div>
        <p className="mt-0.5 text-sm text-ink-muted">{t('about.tagline')}</p>
      </header>

      <section className="rounded-lg border border-edge bg-surface-1 p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-faint">
          {t('about.madeBy')}
        </h2>
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-3 font-mono text-sm font-semibold text-gold">
            {initials(AUTHOR_NAME)}
          </div>
          <div className="min-w-0">
            <div className="font-medium text-ink">{AUTHOR_NAME}</div>
            <p className="text-sm text-ink-muted">{t('about.bio')}</p>
            {authorLinks.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {authorLinks.map((link) => (
                  <SupportButton key={link.id} link={link} />
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-edge bg-surface-1 p-4">
        <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
          <HandHeart className="h-3.5 w-3.5" />
          {t('about.supportHeading')}
        </h2>
        <p className="text-sm text-ink-muted">{t('about.supportBlurb')}</p>
        {donations.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {donations.map((link, index) => (
              <SupportButton key={link.id} link={link} primary={index === 0} />
            ))}
          </div>
        )}
        {projectLinks.length > 0 && (
          <>
            <p className="mt-4 text-xs text-ink-faint">{t('about.nonMonetary')}</p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {projectLinks.map((link) => (
                <SupportButton key={link.id} link={link} />
              ))}
            </div>
          </>
        )}
        {!hasAnySupportLink() && (
          <p className="mt-3 text-xs italic text-ink-faint">{t('about.comingSoon')}</p>
        )}
      </section>

      <section className="rounded-lg border border-edge bg-surface-1 p-4 text-xs text-ink-faint">
        <p>{t('about.version', { version: version ?? '—' })}</p>
        <p className="mt-1">{t('about.disclaimer')}</p>
        <Button variant="ghost" className="mt-3" onClick={() => setOnboardingDone(false)}>
          <GraduationCap className="h-4 w-4" />
          {t('onboarding.showIntro')}
        </Button>
      </section>
    </div>
  );
}
