import React from 'react';

import { OnboardingGate } from '@/components/onboarding-gate';

export function SuperwallOnboarding({ children }: { children: React.ReactNode }) {
  return <OnboardingGate>{children}</OnboardingGate>;
}
