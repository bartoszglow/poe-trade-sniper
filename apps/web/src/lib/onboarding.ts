/**
 * First-run onboarding state (#36): whether the welcome wizard was completed
 * (or skipped) and whether the "Getting started" checklist was dismissed.
 * Per-device localStorage (`sniper.*` convention) with a change event so the
 * shell, Searches page, About and Settings all stay in sync live.
 */

const DONE_KEY = 'sniper.onboardingDone';
const CHECKLIST_DISMISSED_KEY = 'sniper.gettingStartedDismissed';
const CHANGE_EVENT = 'sniper:onboarding-changed';

/** window is absent under the node test runner — the module still loads. */
function notifyChange(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function isOnboardingDone(): boolean {
  return localStorage.getItem(DONE_KEY) === '1';
}

/** `false` re-opens the wizard (the "Show intro" buttons in About/Settings). */
export function setOnboardingDone(done: boolean): void {
  if (done) localStorage.setItem(DONE_KEY, '1');
  else localStorage.removeItem(DONE_KEY);
  notifyChange();
}

export function isGettingStartedDismissed(): boolean {
  return localStorage.getItem(CHECKLIST_DISMISSED_KEY) === '1';
}

export function setGettingStartedDismissed(dismissed: boolean): void {
  if (dismissed) localStorage.setItem(CHECKLIST_DISMISSED_KEY, '1');
  else localStorage.removeItem(CHECKLIST_DISMISSED_KEY);
  notifyChange();
}

export function subscribeOnboarding(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}
