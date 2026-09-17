import {
  SuperwallProvider,
  usePlacement,
  useSuperwall,
  useUser,
  type CustomCallback,
  type CustomCallbackResult,
  type SubscriptionStatus,
} from 'expo-superwall';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { AppState, Platform } from 'react-native';

import {
  WafraBillingContext,
  unavailableBilling,
  type SuperwallBillingStatus,
  type WafraBillingValue,
} from '@/components/superwall-billing-context';
import {
  entitlementSnapshot,
  syncStoreCaptureEntitlement,
  type EntitlementSnapshot,
} from '@/lib/billing';
import {
  publishIosCaptureStatusRefresh,
  setIosLocalCaptureEntitlementLease,
  subscribeIosCaptureEntitlementReset,
} from '@/lib/capture';
import { ENTITLEMENT_ID, localCaptureEntitlementLease, trialDaysLeft } from '@/lib/purchases';
import { useStore } from '@/lib/store';
import type { OnboardingFocus, OnboardingIntention, OnboardingTracking } from '@/lib/types';

export const SUPERWALL_PLACEMENTS = {
  pro: 'pro_upgrade',
  onboarding: 'onboarding',
  postImportPro: 'post_import_pro',
} as const;

const IOS_API_KEY = process.env.EXPO_PUBLIC_SUPERWALL_IOS_API_KEY?.trim() ?? '';
const ANDROID_API_KEY = process.env.EXPO_PUBLIC_SUPERWALL_ANDROID_API_KEY?.trim() ?? '';

function platformApiKey(): string {
  if (Platform.OS === 'ios') return IOS_API_KEY;
  if (Platform.OS === 'android') return ANDROID_API_KEY;
  return '';
}

function localeIdentifier(language: string, marketId: string): string {
  const languageCode = language === 'ar' ? 'ar' : 'en';
  const region = marketId === 'SA' ? 'SA' : 'AE';
  return `${languageCode}_${region}`;
}

function LocalCaptureLeaseSync() {
  const { state } = useStore();

  const syncLocalCaptureLease = useCallback(() => {
    if (!state.hydrated || Platform.OS !== 'ios') return;
    const lease = localCaptureEntitlementLease({
      founderPro: state.founderPro,
      trialStartTs: state.trialStartTs,
    });
    if (!lease) return;
    void setIosLocalCaptureEntitlementLease(lease.expiresAtMs, lease.lifetime)
      .then((applied) => {
        if (applied) publishIosCaptureStatusRefresh();
      })
      .catch(() => {
        // The optional native module failing closed must not crash the ledger.
      });
  }, [state.founderPro, state.hydrated, state.trialStartTs]);

  useEffect(() => {
    syncLocalCaptureLease();
  }, [syncLocalCaptureLease]);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    return subscribeIosCaptureEntitlementReset(syncLocalCaptureLease);
  }, [syncLocalCaptureLease]);

  return null;
}

function hasPro(status: SubscriptionStatus): boolean {
  return status.status === 'ACTIVE' &&
    status.entitlements.some((entitlement) => entitlement.id === ENTITLEMENT_ID);
}

function statusLabel(status: SubscriptionStatus): SuperwallBillingStatus {
  if (status.status === 'UNKNOWN') return 'unknown';
  return hasPro(status) ? 'active' : 'inactive';
}

const ONBOARDING_FOCUS = new Set<OnboardingFocus>(['spending', 'bills', 'cashflow', 'overview']);
const ONBOARDING_TRACKING = new Set<OnboardingTracking>(['none', 'bank-apps', 'spreadsheet', 'finance-app']);
const ONBOARDING_INTENTION = new Set<OnboardingIntention>([
  'control',
  'spend-intentionally',
  'stay-ahead',
  'build-buffer',
]);

function onboardingFocus(value: unknown): OnboardingFocus | null {
  return typeof value === 'string' && ONBOARDING_FOCUS.has(value as OnboardingFocus)
    ? value as OnboardingFocus
    : null;
}

function onboardingTracking(value: unknown): OnboardingTracking | null {
  return typeof value === 'string' && ONBOARDING_TRACKING.has(value as OnboardingTracking)
    ? value as OnboardingTracking
    : null;
}

function onboardingIntention(value: unknown): OnboardingIntention | null {
  return typeof value === 'string' && ONBOARDING_INTENTION.has(value as OnboardingIntention)
    ? value as OnboardingIntention
    : null;
}

/**
 * `request-callback` variable keys are editor-state identifiers. When the Flow
 * uses `replaceNodeIdsWithNames`, those keys become node names rather than the
 * semantic names `focus`, `tracking` and `intention`. Keep this seam resilient
 * to harmless editor renames by accepting an explicit semantic key first and
 * then locating the value by its closed enum.
 */
function onboardingCallbackValue<T>(
  variables: Record<string, unknown>,
  key: string,
  parse: (value: unknown) => T | null,
): T | null {
  const explicit = parse(variables[key]);
  if (explicit) return explicit;
  for (const value of Object.values(variables)) {
    const parsed = parse(value);
    if (parsed) return parsed;
  }
  return null;
}

function SuperwallRuntime({ children }: { children: React.ReactNode }) {
  const { state, ensureDurable, setOnboardingProfile, setPro } = useStore();
  const superwall = useSuperwall();
  const { refresh: refreshUser } = useUser();
  const proPlacement = usePlacement();
  const currentPro = useRef(state.pro);
  const latestSnapshot = useRef<EntitlementSnapshot | null>(null);
  const applyGeneration = useRef(0);
  currentPro.current = state.pro;

  const finishRemoteOnboarding = useCallback(async (
    callback: CustomCallback,
  ): Promise<CustomCallbackResult> => {
    if (callback.name !== 'wafra_onboarding_handoff') {
      return { status: 'failure', data: { reason: 'unsupported_callback' } };
    }
    const callbackVariables = (callback.variables ?? {}) as Record<string, unknown>;
    const focus = onboardingCallbackValue(callbackVariables, 'focus', onboardingFocus);
    const tracking = onboardingCallbackValue(callbackVariables, 'tracking', onboardingTracking);
    const intention = onboardingCallbackValue(callbackVariables, 'intention', onboardingIntention);
    if (!focus || !tracking || !intention) {
      return { status: 'failure', data: { reason: 'invalid_onboarding_answers' } };
    }

    // Durable seam between the remotely editable value journey and Wafra's
    // native name/capture setup. `remote-handoff` is intentionally a persisted
    // state: a process death after dismissal returns to the local name surface
    // rather than replaying the Superwall questionnaire.
    setOnboardingProfile({
      v: 1,
      stage: 'remote-handoff',
      focus,
      tracking,
      intention,
      startedAt: state.onboardingProfile?.startedAt ?? Date.now(),
    });
    try {
      await ensureDurable();
    } catch {
      return { status: 'failure', data: { reason: 'onboarding_handoff_not_durable' } };
    }

    if (!state.privateMode) {
      void superwall.setUserAttributes({
        wafra_onboarding_focus: focus,
        wafra_onboarding_tracking: tracking,
        wafra_onboarding_intention: intention,
        wafra_onboarding_value_flow_complete: true,
      }).catch(() => {});
    }
    void superwall.dismiss().catch(() => {});
    return { status: 'success', data: { next: 'native_name_then_capture' } };
  }, [ensureDurable, setOnboardingProfile, state.onboardingProfile?.startedAt, state.privateMode, superwall]);

  const onboardingPlacement = usePlacement({
    onCustomCallback: finishRemoteOnboarding,
  });

  const applySnapshot = useCallback(async (snapshot: EntitlementSnapshot | null) => {
    if (!snapshot) return;
    const generation = ++applyGeneration.current;
    let nativeAccepted = true;
    try {
      nativeAccepted = await syncStoreCaptureEntitlement(snapshot);
    } catch {
      // Billing state can still update. The native capture extension fails closed
      // until a build containing the expected App Intent module is installed.
      nativeAccepted = true;
    }
    if (generation !== applyGeneration.current || !nativeAccepted) return;
    latestSnapshot.current = snapshot;
    if (snapshot.active === currentPro.current) return;
    currentPro.current = snapshot.active;
    setPro(snapshot.active);
  }, [setPro]);

  useEffect(() => {
    if (!state.hydrated || !superwall.isConfigured) return;
    void applySnapshot(entitlementSnapshot(
      superwall.subscriptionStatus,
      superwall.customerInfo,
      Date.now(),
    ));
  }, [
    applySnapshot,
    state.hydrated,
    superwall.customerInfo,
    superwall.isConfigured,
    superwall.subscriptionStatus,
  ]);

  const refresh = useCallback(async () => {
    if (!superwall.isConfigured) return;
    try {
      await refreshUser();
      // `UNKNOWN` is a real state. Never synthesize INACTIVE from an empty or
      // partial entitlement fetch during foreground refresh.
      await superwall.getCustomerInfo();
    } catch {
      // Unreachable store/configuration is UNKNOWN, not evidence of cancellation.
    }
  }, [refreshUser, superwall]);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    return subscribeIosCaptureEntitlementReset(() => {
      const snapshot = latestSnapshot.current;
      if (snapshot) void applySnapshot(snapshot);
      else void refresh();
    });
  }, [applySnapshot, refresh]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  // The saved local-only preference keeps purchases available but disables
  // optional Superwall event collection and Wafra-supplied targeting metadata.
  useEffect(() => {
    if (!superwall.isConfigured || !state.hydrated) return;
    void superwall.setEventTrackingBehavior(state.privateMode ? 'none' : 'all').catch(() => {});
  }, [state.hydrated, state.privateMode, superwall, superwall.isConfigured]);

  // Product/onboarding metadata only. Never ledger rows, balances, transaction
  // amounts, SMS bodies, account/card identifiers, or the user's name.
  useEffect(() => {
    if (!superwall.isConfigured || !state.hydrated || state.privateMode) return;
    void superwall.setUserAttributes({
      wafra_language: state.language === 'ar' ? 'ar' : 'en',
      wafra_market: state.marketId,
      wafra_onboarded: state.onboarded,
      wafra_onboarding_focus: state.onboardingProfile?.focus ?? null,
      wafra_onboarding_tracking: state.onboardingProfile?.tracking ?? null,
      wafra_onboarding_intention: state.onboardingProfile?.intention ?? null,
      wafra_capture_choice: state.captureOptOut ? 'manual' : 'automatic',
      wafra_trial_days_left: trialDaysLeft(state),
    }).catch(() => {});
  }, [
    state.captureOptOut,
    state.hydrated,
    state.language,
    state.marketId,
    state.onboarded,
    state.privateMode,
    state.onboardingProfile?.focus,
    state.onboardingProfile?.intention,
    state.onboardingProfile?.tracking,
    state.trialStartTs,
    superwall,
    superwall.isConfigured,
  ]);

  const presentProPaywall = useCallback(async (params: Record<string, unknown> = {}) => {
    if (!superwall.isConfigured) throw new Error('SUPERWALL_NOT_CONFIGURED');
    await proPlacement.registerPlacement({
      placement: SUPERWALL_PLACEMENTS.pro,
      params: {
        source: 'wafra_pro',
        language: state.language === 'ar' ? 'ar' : 'en',
        market: state.marketId,
        focus: state.onboardingProfile?.focus ?? null,
        intention: state.onboardingProfile?.intention ?? null,
        ...params,
      },
    });
  }, [
    proPlacement,
    state.language,
    state.marketId,
    state.onboardingProfile?.focus,
    state.onboardingProfile?.intention,
    superwall.isConfigured,
  ]);

  const presentOnboardingFlow = useCallback(async () => {
    if (!superwall.isConfigured) throw new Error('SUPERWALL_NOT_CONFIGURED');
    await onboardingPlacement.registerPlacement({
      placement: SUPERWALL_PLACEMENTS.onboarding,
      params: {
        source: 'first_run',
        language: state.language === 'ar' ? 'ar' : 'en',
        market: state.marketId,
        platform: Platform.OS,
      },
    });
  }, [
    onboardingPlacement,
    state.language,
    state.marketId,
    superwall.isConfigured,
  ]);

  const restorePro = useCallback(async (): Promise<boolean | null> => {
    if (!superwall.isConfigured) return null;
    try {
      const restored = await superwall.restorePurchases();
      if (restored.result === 'failed') return null;
      const [info, entitlements] = await Promise.all([
        superwall.getCustomerInfo(),
        superwall.getEntitlements(),
      ]);
      const active = entitlements.active.some((item) => item.id === ENTITLEMENT_ID);
      const resolved: SubscriptionStatus = active
        ? { status: 'ACTIVE', entitlements: entitlements.active }
        : { status: 'INACTIVE' };
      await applySnapshot(entitlementSnapshot(resolved, info, Date.now()));
      return active;
    } catch {
      return null;
    }
  }, [applySnapshot, superwall]);

  const value = useMemo<WafraBillingValue>(() => ({
    available: true,
    configured: superwall.isConfigured,
    configurationError: superwall.configurationError,
    subscriptionStatus: statusLabel(superwall.subscriptionStatus),
    paywallStatus: proPlacement.state.status,
    onboardingFlowStatus: onboardingPlacement.state.status,
    presentProPaywall,
    presentOnboardingFlow,
    restorePro,
    refresh,
  }), [
    onboardingPlacement.state.status,
    presentOnboardingFlow,
    presentProPaywall,
    proPlacement.state.status,
    refresh,
    restorePro,
    superwall.configurationError,
    superwall.isConfigured,
    superwall.subscriptionStatus,
  ]);

  return (
    <WafraBillingContext.Provider value={value}>
      {children}
    </WafraBillingContext.Provider>
  );
}

/** Native monetization root. Superwall owns checkout, restore and remote UX. */
export function SuperwallBillingProvider({ children }: { children: React.ReactNode }) {
  const { state } = useStore();
  const key = platformApiKey();
  const available = state.hydrated && key.length > 0;
  const options = useMemo(() => ({
    localeIdentifier: localeIdentifier(state.language, state.marketId),
    eventTrackingBehavior: state.privateMode ? 'none' as const : 'all' as const,
    shouldObservePurchases: true,
    paywalls: {
      shouldPreload: true,
      isHapticFeedbackEnabled: true,
    },
  }), [state.language, state.marketId, state.privateMode]);

  return (
    <>
      <LocalCaptureLeaseSync />
      {available ? (
        <SuperwallProvider
          apiKeys={{ ios: IOS_API_KEY, android: ANDROID_API_KEY }}
          options={options}
          onConfigurationError={(error) => {
            if (__DEV__) console.warn('[Superwall] configuration failed', error.message);
          }}>
          <SuperwallRuntime>{children}</SuperwallRuntime>
        </SuperwallProvider>
      ) : (
        <WafraBillingContext.Provider value={unavailableBilling}>
          {children}
        </WafraBillingContext.Provider>
      )}
    </>
  );
}
