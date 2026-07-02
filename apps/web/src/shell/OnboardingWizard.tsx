import { useState, type ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { LogIn, Lock, TriangleAlert, Zap } from 'lucide-react';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { useIsDesktopWidth } from '../hooks/useIsDesktopWidth';
import { useLoginCapture } from '../hooks/useLoginCapture';
import { useServerStatus } from '../hooks/useServerStatus';
import { useT } from '../i18n/i18n';
import { setOnboardingDone } from '../lib/onboarding';

/**
 * First-run welcome wizard (#36) — absorbs the LoginOverlay on a fresh device:
 * four steps teaching (1) what the app is, (2) that the PoE session is REQUIRED
 * (with the real login button embedded; skippable per D-onb-1), (3) how a
 * search is built on the trade site incl. the Instant-Buyout requirement
 * (D-onb-3), (4) where hits stream. Content adapts to the `lg` breakpoint.
 * Completion (or skipping) persists `sniper.onboardingDone`; "Show intro" in
 * About/Settings clears the flag to re-open it.
 */

interface StepProps {
  isDesktopWidth: boolean;
  goNext: () => void;
  goBack: () => void;
  /**
   * Close the wizard for good (marks onboarding done). `navigateHome` only on
   * the final "Start sniping" — a skip or a link-out must stay where it is
   * (skipping from About/Settings would otherwise yank the user to Searches).
   */
  closeWizard: (options?: { navigateHome?: boolean }) => void;
}

function WelcomeStep({ goNext, closeWizard }: StepProps) {
  const t = useT();
  return (
    <>
      <div className="space-y-3 p-5">
        <h2 className="text-base font-semibold text-ink">{t('onboarding.welcomeTitle')}</h2>
        <p className="text-sm text-ink-muted">{t('onboarding.welcomeBody')}</p>
        <p className="text-sm font-medium text-ink">{t('onboarding.welcomeManual')}</p>
        <p className="flex items-center gap-2 text-sm text-ink-muted">
          <Badge tone="gold">LIVE</Badge>
          <Badge tone="info">POLL</Badge>
          {t('onboarding.welcomeModes')}
        </p>
        <p className="border-t border-edge pt-3 text-xs text-ink-faint">
          {t('onboarding.disclaimer')}
        </p>
      </div>
      <footer className="flex items-center gap-2 border-t border-edge px-5 py-3">
        <button
          type="button"
          onClick={() => closeWizard()}
          className="text-xs text-ink-faint underline underline-offset-2 hover:text-ink"
        >
          {t('onboarding.skipIntro')}
        </button>
        <div className="flex-1" />
        <Button variant="primary" onClick={goNext}>
          {t('onboarding.next')}
        </Button>
      </footer>
    </>
  );
}

function LoginStep({ isDesktopWidth, goNext, goBack, closeWizard }: StepProps) {
  const t = useT();
  const { status, refresh } = useServerStatus();
  const { loginState, loginDetail, start, cancel } = useLoginCapture(refresh);
  // Re-opened via "Show intro" with a live session: show the connected state
  // instead of a "required" pitch with a pointless login button.
  const sessionValid = status?.session.hasSession === true && status.session.probedValid !== false;
  return (
    <>
      <div className="space-y-3 p-5">
        <h2 className="text-base font-semibold text-ink">{t('onboarding.loginTitle')}</h2>
        <p className="text-sm text-ink-muted">{t('onboarding.loginWhy')}</p>
        {sessionValid ? (
          <p className="flex items-center gap-2 pt-1 text-sm text-ink">
            <Badge tone="ok">{t('onboarding.loginConnected')}</Badge>
          </p>
        ) : (
          <>
            {isDesktopWidth ? (
              <p className="text-sm text-ink-muted">{t('onboarding.loginChrome')}</p>
            ) : (
              <p className="rounded-md border border-info/40 bg-info/10 px-3 py-2 text-sm text-ink">
                {t('onboarding.loginMobile')}
              </p>
            )}
            <div className="flex flex-col items-center gap-2 pt-1">
              <Button
                variant="primary"
                className="w-full justify-center"
                disabled={loginState === 'waiting-login'}
                onClick={start}
              >
                <LogIn className="h-4 w-4" />
                {t('login.withPoe')}
              </Button>
              {loginState === 'waiting-login' && (
                <span className="flex items-center gap-2">
                  <Badge tone="gold">{t('login.waiting')}</Badge>
                  <Button variant="ghost" onClick={cancel}>
                    {t('common.cancel')}
                  </Button>
                </span>
              )}
              {loginDetail && <p className="text-xs text-ink-faint">{loginDetail}</p>}
              {/* The wizard must get out of the way of its own escape hatch —
                  close (no home-navigate) and let the Link land on Settings. */}
              <Link
                to="/settings"
                onClick={() => closeWizard()}
                className="text-xs text-ink-faint underline underline-offset-2 hover:text-ink"
              >
                {t('login.pasteInSettings')}
              </Link>
            </div>
          </>
        )}
        <p className="flex gap-2 rounded-md border border-edge bg-surface-2 px-3 py-2 text-xs text-ink-muted">
          <Lock className="h-4 w-4 shrink-0 text-gold" />
          {t('onboarding.loginPrivacy')}
        </p>
      </div>
      <footer className="flex items-center gap-2 border-t border-edge px-5 py-3">
        <Button variant="ghost" onClick={goBack}>
          {t('onboarding.back')}
        </Button>
        <div className="flex-1" />
        {sessionValid ? (
          <Button variant="primary" onClick={goNext}>
            {t('onboarding.next')}
          </Button>
        ) : (
          <>
            <span className="text-xs text-warn">{t('onboarding.loginSkipWarning')}</span>
            <Button variant="ghost" onClick={goNext}>
              {t('onboarding.loginSkip')}
            </Button>
          </>
        )}
      </footer>
    </>
  );
}

function HowToStep({ goNext, goBack }: StepProps) {
  const t = useT();
  const steps: Array<{ text: string; hint?: string; urlbar?: boolean }> = [
    { text: t('onboarding.searchStepBuild'), hint: t('onboarding.searchStepBuildHint') },
    { text: t('onboarding.searchStepInstant'), hint: t('onboarding.searchStepInstantHint') },
    { text: t('onboarding.searchStepCopy'), urlbar: true },
    { text: t('onboarding.searchStepPaste') },
  ];
  return (
    <>
      <div className="space-y-3 p-5">
        <h2 className="text-base font-semibold text-ink">{t('onboarding.searchTitle')}</h2>
        <ol className="space-y-2.5">
          {steps.map((step, index) => (
            <li key={step.text} className="flex gap-2.5 text-sm text-ink">
              <span className="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full border border-edge-strong bg-surface-3 text-[11px] font-bold text-gold-bright">
                {index + 1}
              </span>
              <span className="min-w-0">
                {step.text}
                {step.hint && <span className="block text-xs text-ink-muted">{step.hint}</span>}
                {step.urlbar && (
                  <span className="mt-1 block truncate rounded-md border border-edge-strong bg-surface-0 px-2.5 py-1 font-mono text-[11px] text-ink-muted">
                    pathofexile.com/trade2/search/poe2/Standard/
                    <b className="rounded-sm bg-gold/15 px-0.5 text-gold-bright">Abc4dE7fG</b>
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
        <p className="flex gap-2 rounded-md border border-warn/50 bg-warn/10 px-3 py-2 text-xs text-ink">
          <TriangleAlert className="h-4 w-4 shrink-0 text-warn" />
          {t('onboarding.searchTravelWarning')}
        </p>
        <p className="text-xs text-ink-muted">
          <b className="text-ink">ACTIVE</b> — {t('onboarding.legendActive')} ·{' '}
          <b className="text-ink">TRAVEL</b> — {t('onboarding.legendTravel')} ·{' '}
          <b className="text-ink">BUY</b> — {t('onboarding.legendBuy')}
        </p>
      </div>
      <footer className="flex items-center gap-2 border-t border-edge px-5 py-3">
        <Button variant="ghost" onClick={goBack}>
          {t('onboarding.back')}
        </Button>
        <div className="flex-1" />
        <Button variant="primary" onClick={goNext}>
          {t('onboarding.next')}
        </Button>
      </footer>
    </>
  );
}

function HitsStep({ isDesktopWidth, goBack, closeWizard }: StepProps) {
  const t = useT();
  return (
    <>
      <div className="space-y-3 p-5">
        {isDesktopWidth ? (
          <>
            <h2 className="text-base font-semibold text-ink">{t('onboarding.hitsTitle')}</h2>
            <p className="text-sm text-ink-muted">{t('onboarding.hitsBody')}</p>
            <div className="flex gap-2 text-center text-[11px] text-ink-faint">
              <span className="w-10 rounded-md border border-dashed border-edge-strong px-1 py-1.5">
                nav
              </span>
              <span className="flex-1 rounded-md border border-dashed border-edge-strong px-1 py-1.5">
                {t('nav.searches')}
              </span>
              <span className="w-36 rounded-md border border-dashed border-gold px-1 py-1.5 text-gold-bright">
                <Zap className="mr-1 inline h-3 w-3" />
                {t('hitsPanel.title')}
              </span>
            </div>
            <p className="text-sm text-ink-muted">{t('onboarding.hitsPanelHint')}</p>
          </>
        ) : (
          <>
            <h2 className="text-base font-semibold text-ink">{t('onboarding.hitsMobileTitle')}</h2>
            <p className="text-sm text-ink-muted">{t('onboarding.hitsMobileBody')}</p>
            <p className="rounded-md border border-info/40 bg-info/10 px-3 py-2 text-sm text-ink">
              {t('onboarding.hitsMobileNote')}
            </p>
          </>
        )}
      </div>
      <footer className="flex items-center gap-2 border-t border-edge px-5 py-3">
        <Button variant="ghost" onClick={goBack}>
          {t('onboarding.back')}
        </Button>
        <div className="flex-1" />
        <Button variant="primary" onClick={() => closeWizard({ navigateHome: true })}>
          {t('onboarding.finish')}
        </Button>
      </footer>
    </>
  );
}

/** Step registry — adding a step = adding an entry (open/closed). */
const STEPS: Array<{ id: string; Step: ComponentType<StepProps> }> = [
  { id: 'welcome', Step: WelcomeStep },
  { id: 'login', Step: LoginStep },
  { id: 'first-search', Step: HowToStep },
  { id: 'hits', Step: HitsStep },
];
const LOGIN_STEP_INDEX = STEPS.findIndex((step) => step.id === 'login');

export function OnboardingWizard({ onClose }: { onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const isDesktopWidth = useIsDesktopWidth();
  const [stepIndex, setStepIndex] = useState(0);
  const { status } = useServerStatus();

  // A successful login auto-advances past the login step (adjust-on-prop-change:
  // the status poll flips sessionValid while the step is showing).
  const sessionValid = status?.session.hasSession === true && status.session.probedValid !== false;
  const [lastSessionValid, setLastSessionValid] = useState(sessionValid);
  if (sessionValid !== lastSessionValid) {
    setLastSessionValid(sessionValid);
    if (sessionValid && stepIndex === LOGIN_STEP_INDEX) setStepIndex(stepIndex + 1);
  }

  function closeWizard(options?: { navigateHome?: boolean }): void {
    setOnboardingDone(true);
    onClose();
    // Only the final "Start sniping" lands on Searches; skips and link-outs
    // stay wherever the operator was (About/Settings re-open, cookie paste).
    if (options?.navigateHome) void navigate('/');
  }

  const { Step } = STEPS[stepIndex]!;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('onboarding.welcomeTitle')}
      className="fixed inset-0 z-50 flex items-center justify-center bg-surface-0/80 p-4 backdrop-blur-sm"
    >
      <div className="flex max-h-full w-full max-w-lg flex-col overflow-y-auto rounded-xl border border-edge-strong bg-surface-1 shadow-2xl">
        <header className="flex items-center gap-2 border-b border-edge px-5 py-3">
          <span className="font-mono text-sm font-semibold tracking-wide text-gold">
            PoE Trade Sniper
          </span>
          <div className="flex-1" />
          <div
            className="flex items-center gap-1.5"
            aria-label={`${stepIndex + 1} / ${STEPS.length}`}
          >
            {STEPS.map((step, index) => (
              <span
                key={step.id}
                className={`h-1.5 w-1.5 rounded-full ${
                  index === stepIndex ? 'bg-gold' : 'border border-edge-strong bg-surface-3'
                }`}
              />
            ))}
          </div>
        </header>
        <Step
          isDesktopWidth={isDesktopWidth}
          goNext={() => setStepIndex(Math.min(stepIndex + 1, STEPS.length - 1))}
          goBack={() => setStepIndex(Math.max(stepIndex - 1, 0))}
          closeWizard={closeWizard}
        />
      </div>
    </div>
  );
}
