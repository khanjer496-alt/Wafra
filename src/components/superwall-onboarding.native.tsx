import React from 'react';

import { OnboardingGate } from '@/components/onboarding-gate';

/**
 * Wafra owns the native first-run journey.
 *
 * Keep this compatibility wrapper because app-root-layout already mounts it,
 * but do not let a remote Superwall campaign replace the cinematic onboarding.
 * SuperwallBillingProvider remains mounted above this component and continues
 * to own Pro paywalls, purchase/restore and entitlement state.
 */
export function SuperwallOnboarding({ children }: { children: React.ReactNode }) {
  return <OnboardingGate>{children}</OnboardingGate>;
}
