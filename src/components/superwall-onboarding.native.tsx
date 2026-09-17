import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';

import { OnboardingGate } from '@/components/onboarding-gate';
import { useWafraBilling } from '@/components/superwall-billing-context';
import { useTheme } from '@/hooks/use-theme';
import { loadIosMessageSetupProgress } from '@/lib/ios-message-onboarding';
import { useStore } from '@/lib/store';

const SUPERWALL_BOOT_GRACE_MS = 2_500;

function isRemoteValueJourney(
  onboarded: boolean,
  profileStage: string | null,
  hasSavedPlan: boolean,
  privateMode: boolean,
): boolean {
  if (onboarded || hasSavedPlan || privateMode) return false;
  return profileStage === null || profileStage === 'welcome';
}

/**
 * New installs use Superwall for the remotely editable value journey. Everything
 * that depends on device state (local name, permissions, notification access,
 * Shortcuts, imports, recovery) stays in OnboardingGate.
 */
export function SuperwallOnboarding({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const { state, hydrationFailed } = useStore();
  const billing = useWafraBilling();
  const attempted = useRef(false);
  const [nativeFallback, setNativeFallback] = useState(false);
  const [resumeChecked, setResumeChecked] = useState(Platform.OS !== 'ios');
  const profileStage = state.onboardingProfile?.stage ?? null;
  const remoteCandidate = isRemoteValueJourney(
    state.onboarded,
    profileStage,
    state.onboardingPlan !== null,
    state.privateMode,
  );

  useEffect(() => {
    if (!state.hydrated || hydrationFailed || Platform.OS !== 'ios' || !remoteCandidate) {
      setResumeChecked(true);
      return;
    }
    let cancelled = false;
    void loadIosMessageSetupProgress()
      .then((progress) => {
        if (cancelled) return;
        if (progress?.returnToOnboarding === true) setNativeFallback(true);
        setResumeChecked(true);
      })
      .catch(() => {
        if (!cancelled) {
          setNativeFallback(true);
          setResumeChecked(true);
        }
      });
    return () => { cancelled = true; };
  }, [hydrationFailed, remoteCandidate, state.hydrated]);

  useEffect(() => {
    if (state.onboarded) {
      attempted.current = false;
      setNativeFallback(false);
    }
  }, [state.onboarded]);

  useEffect(() => {
    if (
      !state.hydrated || hydrationFailed || !remoteCandidate || !resumeChecked ||
      nativeFallback || !billing.available || billing.configured || billing.configurationError
    ) return;
    const timer = setTimeout(() => setNativeFallback(true), SUPERWALL_BOOT_GRACE_MS);
    return () => clearTimeout(timer);
  }, [
    billing.available,
    billing.configurationError,
    billing.configured,
    hydrationFailed,
    nativeFallback,
    remoteCandidate,
    resumeChecked,
    state.hydrated,
  ]);

  useEffect(() => {
    if (
      !state.hydrated || hydrationFailed || !remoteCandidate || !resumeChecked ||
      nativeFallback || attempted.current || !billing.available || !billing.configured
    ) return;
    attempted.current = true;
    void billing.presentOnboardingFlow().catch(() => setNativeFallback(true));
  }, [
    billing,
    hydrationFailed,
    nativeFallback,
    remoteCandidate,
    resumeChecked,
    state.hydrated,
  ]);

  useEffect(() => {
    if (!attempted.current) return;
    if (billing.onboardingFlowStatus === 'error' || billing.onboardingFlowStatus === 'skipped') {
      setNativeFallback(true);
    }
    if (billing.onboardingFlowStatus === 'dismissed' && remoteCandidate) {
      setNativeFallback(true);
    }
  }, [billing.onboardingFlowStatus, remoteCandidate]);

  const useNative = useMemo(() => (
    hydrationFailed ||
    !state.hydrated ||
    !remoteCandidate ||
    nativeFallback ||
    !billing.available ||
    billing.configurationError !== null
  ), [
    billing.available,
    billing.configurationError,
    hydrationFailed,
    nativeFallback,
    remoteCandidate,
    state.hydrated,
  ]);

  if (useNative) return <OnboardingGate>{children}</OnboardingGate>;

  return (
    <View style={[styles.hold, { backgroundColor: theme.background }]} accessibilityElementsHidden>
      {billing.onboardingFlowStatus !== 'presented' && <ActivityIndicator color={theme.primary} />}
    </View>
  );
}

const styles = StyleSheet.create({
  hold: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
