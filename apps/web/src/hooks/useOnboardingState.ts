import { useEffect, useState } from 'react';
import {
  isGettingStartedDismissed,
  isOnboardingDone,
  subscribeOnboarding,
} from '../lib/onboarding';

interface OnboardingState {
  wizardDone: boolean;
  checklistDismissed: boolean;
}

function read(): OnboardingState {
  return { wizardDone: isOnboardingDone(), checklistDismissed: isGettingStartedDismissed() };
}

/** Live view of the onboarding flags (#36); see lib/onboarding.ts. */
export function useOnboardingState(): OnboardingState {
  const [state, setState] = useState<OnboardingState>(read);
  useEffect(() => subscribeOnboarding(() => setState(read())), []);
  return state;
}
