import { ComplimentaryRefresh } from '@/components/complimentary-refresh';
import {
  SuperwallProvider,
  usePlacement,
  useSuperwall,
  type CustomCallback,
  type CustomCallbackResult,
  type SubscriptionStatus,
} from 'expo-superwall';
import { useLocales } from 'expo-localization';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import {
  WafraBillingContext,
  unavailableBilling,
  type ProPlanOffer,
  type ProPurchaseOutcome,
  type SuperwallBillingStatus,
  type WafraBillingValue,
} from '@/components/superwall-billing-context';
import { runAfterFirstFrames } from '@/lib/after-first-frames';
import {
  isAndroidPlayBillingAvailable,
  queryAndroidPlaySubscriptions,
  type AndroidPlaySubscriptionSnapshot,
} from '@/lib/android-play-billing';
import {
  entitlementSnapshot,
  syncStoreCaptureEntitlement,
  type EntitlementSnapshot,
} from '@/lib/billing';
import { billingLocaleIdentifier } from '@/lib/billing-locale';
import {
  publishIosCaptureStatusRefresh,
  setIosLocalCaptureEntitlementLease,
  subscribeIosCaptureEntitlementReset,
} from '@/lib/capture';
import {
  ENTITLEMENT_ID,
  localCaptureEntitlementLease,
  proOffersFromProducts,
  proProductIdsForPlatform,
} from '@/lib/purchases';
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

type AndroidMoneyAction = { session: number };

function unresolvedPlayOwnership(): AndroidPlaySubscriptionSnapshot {
  return { status: 'unknown', activeProductIds: [], pendingProductIds: [], responseCode: null };
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

function SuperwallRuntime({ onValue }: {
  /** Receives every billing value (null once this runtime unmounts); the provider above hands it to the app. */
  onValue?: (value: WafraBillingValue | null) => void;
}) {
  const { state, ensureDurable, setOnboardingProfile, setPro } = useStore();
  // Attribute writes replace the SDK's `user` snapshot even when its values
  // are unchanged. Subscribing to that snapshot and depending on the whole
  // store in a writing effect creates an endless native write/event loop.
  const {
    isConfigured, configurationError, subscriptionStatus, customerInfo,
    setEventTrackingBehavior,
    getCustomerInfo, getEntitlements, restorePurchases, dismiss,
    products, purchase,
  } = useSuperwall((sdk) => ({
    isConfigured: sdk.isConfigured,
    configurationError: sdk.configurationError,
    subscriptionStatus: sdk.subscriptionStatus,
    customerInfo: sdk.customerInfo,
    setEventTrackingBehavior: sdk.setEventTrackingBehavior,
    getCustomerInfo: sdk.getCustomerInfo,
    getEntitlements: sdk.getEntitlements,
    restorePurchases: sdk.restorePurchases,
    dismiss: sdk.dismiss,
    products: sdk.products,
    purchase: sdk.purchase,
  }));
  const proPlacement = usePlacement();
  const currentPro = useRef(state.pro);
  const latestSnapshot = useRef<EntitlementSnapshot | null>(null);
  const applyGeneration = useRef(0);
  /** Product ids from the most recent offer fetch — the only ones purchasable. */
  const purchasableProductIds = useRef<Set<string>>(new Set());
  /** Counts offer fetches, so a superseded one cannot replace the ids above. */
  const offersGeneration = useRef(0);
  const androidQueryGeneration = useRef(0);
  const androidMoneyAction = useRef<AndroidMoneyAction | null>(null);
  const androidSessionGeneration = useRef(0);
  const androidRefreshDeferred = useRef(false);
  const billingReady = useRef(state.hydrated && isConfigured);
  const mounted = useRef(true);
  const [androidSubscriptionStatus, setAndroidSubscriptionStatus] = useState<SuperwallBillingStatus>('unknown');
  currentPro.current = state.pro;
  billingReady.current = state.hydrated && isConfigured;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      androidQueryGeneration.current += 1;
      androidSessionGeneration.current += 1;
    };
  }, []);

  const refreshAndroid = useCallback(async (
    action: AndroidMoneyAction | null = null,
  ): Promise<AndroidPlaySubscriptionSnapshot> => {
    const unresolved = unresolvedPlayOwnership();
    if (!mounted.current || !billingReady.current ||
        (action && action.session !== androidSessionGeneration.current)) return unresolved;
    if (androidMoneyAction.current !== action) {
      if (!action && androidMoneyAction.current) androidRefreshDeferred.current = true;
      return unresolved;
    }
    const generation = ++androidQueryGeneration.current;
    const snapshot = await queryAndroidPlaySubscriptions().catch(() => unresolved);
    if (!mounted.current || !billingReady.current || generation !== androidQueryGeneration.current ||
        androidMoneyAction.current !== action ||
        (action && action.session !== androidSessionGeneration.current)) return unresolved;
    setAndroidSubscriptionStatus(snapshot.status);
    if (snapshot.status !== 'unknown') {
      const active = snapshot.status === 'active';
      if (active !== currentPro.current) {
        currentPro.current = active;
        setPro(active);
      }
    }
    return snapshot;
  }, [setPro]);

  const finishAndroidAction = useCallback((action: AndroidMoneyAction) => {
    if (androidMoneyAction.current !== action) return;
    androidMoneyAction.current = null;
    if (androidRefreshDeferred.current) {
      androidRefreshDeferred.current = false;
      void refreshAndroid();
    }
  }, [refreshAndroid]);

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

    // These preferences stay on the device; billing does not need targeting attributes.
    void dismiss().catch(() => {});
    return { status: 'success', data: { next: 'native_name_then_capture' } };
  }, [ensureDurable, setOnboardingProfile, state.onboardingProfile?.startedAt, dismiss]);

  const onboardingPlacement = usePlacement({
    onCustomCallback: finishRemoteOnboarding,
  });

  const storeQueryAvailable = Platform.OS !== 'android' || isAndroidPlayBillingAvailable();

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
    if (!state.hydrated || !isConfigured) {
      androidQueryGeneration.current += 1;
      androidSessionGeneration.current += 1;
      setAndroidSubscriptionStatus('unknown');
      return;
    }
    if (Platform.OS === 'android') {
      // SDK callbacks are refresh signals, not a fresh Play ownership answer.
      // In particular, a failed SDK query must not revoke a cached subscriber.
      void refreshAndroid();
      return;
    }
    void applySnapshot(entitlementSnapshot(
      subscriptionStatus,
      customerInfo,
      Date.now(),
    ));
  }, [
    applySnapshot,
    state.hydrated,
    customerInfo,
    isConfigured,
    refreshAndroid,
    subscriptionStatus,
  ]);

  const refresh = useCallback(async () => {
    if (!isConfigured) return;
    if (Platform.OS === 'android') {
      await refreshAndroid();
      return;
    }
    try {
      // `UNKNOWN` is a real state. Never synthesize INACTIVE from an empty or
      // partial entitlement fetch during foreground refresh.
      await getCustomerInfo();
    } catch {
      // Unreachable store/configuration is UNKNOWN, not evidence of cancellation.
    }
  }, [getCustomerInfo, isConfigured, refreshAndroid]);

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

  // Optional analytics stay off even when the saved local-only mode is lifted.
  // This is the SDK's supported event/MMP opt-out, not proof that its separate
  // server-configured ASA or enrichment network paths are disabled.
  useEffect(() => {
    if (!isConfigured || !state.hydrated) return;
    void setEventTrackingBehavior('none').catch(() => {});
  }, [state.hydrated, isConfigured, setEventTrackingBehavior]);

  // The ONE placement parameter Wafra sends: the saved app language, exactly "en" or "ar".
  // It is a setting, not personal data, and it lets the onboarding Flow choose the Arabic
  // pages after an in-session language change (the SDK's localeIdentifier is fixed at
  // configure time). No market, source, focus, intention, platform or user attribute is sent.
  const placementLanguage: 'en' | 'ar' = state.language === 'ar' ? 'ar' : 'en';

  const presentProPaywall = useCallback(async () => {
    if (!isConfigured) throw new Error('SUPERWALL_NOT_CONFIGURED');
    await proPlacement.registerPlacement({
      placement: SUPERWALL_PLACEMENTS.pro,
      params: { language: placementLanguage },
    });
  }, [
    proPlacement,
    placementLanguage,
    isConfigured,
  ]);

  const presentOnboardingFlow = useCallback(async () => {
    if (!isConfigured) throw new Error('SUPERWALL_NOT_CONFIGURED');
    await onboardingPlacement.registerPlacement({
      placement: SUPERWALL_PLACEMENTS.onboarding,
      params: { language: placementLanguage },
    });
  }, [
    onboardingPlacement,
    placementLanguage,
    isConfigured,
  ]);

  /**
   * Verify iOS `pro` through the SDK after checkout or restore.
   *
   * A completed transaction is not an entitlement: a product that is not
   * attached to `pro` in Superwall charges successfully and grants nothing.
   * Both iOS actions resolve through this verification so neither
   * can unlock Pro on the strength of a receipt alone.
   */
  const verifyProEntitlement = useCallback(async (): Promise<boolean> => {
    const [info, entitlements] = await Promise.all([
      getCustomerInfo(),
      getEntitlements(),
    ]);
    const active = entitlements.active.some((item) => item.id === ENTITLEMENT_ID);
    const resolved: SubscriptionStatus = active
      ? { status: 'ACTIVE', entitlements: entitlements.active }
      : { status: 'INACTIVE' };
    await applySnapshot(entitlementSnapshot(resolved, info, Date.now()));
    return active;
  }, [applySnapshot, getCustomerInfo, getEntitlements]);

  const restorePro = useCallback(async (): Promise<boolean | null> => {
    if (!isConfigured || !storeQueryAvailable) return null;
    if (Platform.OS === 'android') {
      if (androidMoneyAction.current) return null;
      const action = { session: androidSessionGeneration.current };
      androidMoneyAction.current = action;
      androidQueryGeneration.current += 1;
      try {
        try {
          await restorePurchases();
        } catch {
          // The independent Play query can still recover an owned plan.
        }
        const snapshot = await refreshAndroid(action);
        return snapshot.status === 'unknown' ? null : snapshot.status === 'active';
      } finally {
        finishAndroidAction(action);
      }
    }
    try {
      const restored = await restorePurchases();
      if (restored.result === 'failed') return null;
      return await verifyProEntitlement();
    } catch {
      return null;
    }
  }, [finishAndroidAction, isConfigured, refreshAndroid, restorePurchases, storeQueryAvailable, verifyProEntitlement]);

  /**
   * The prices Wafra's own Pro screen shows. Every figure comes from the
   * device's storefront through the SDK; a plan the store does not return is
   * simply absent rather than advertised at a price nobody will be charged.
   */
  const fetchProOffers = useCallback(async (): Promise<ProPlanOffer[]> => {
    const generation = (offersGeneration.current += 1);
    // A replacement lookup invalidates old prices immediately, including when
    // the store becomes unavailable or the latest request fails.
    purchasableProductIds.current = new Set();
    if (!isConfigured || !storeQueryAvailable) return [];
    try {
      const offers = proOffersFromProducts(await products(proProductIdsForPlatform()));
      // A superseded response must neither republish an old list to its caller
      // nor replace the product ids authorized by a newer successful response.
      if (generation !== offersGeneration.current) return [];
      purchasableProductIds.current = new Set(offers.map((offer) => offer.productId));
      return offers;
    } catch {
      return [];
    }
  }, [isConfigured, products, storeQueryAvailable]);

  /** Native checkout: the store's own sheet, opened from Wafra's Pro screen. */
  const purchasePro = useCallback(async (
    productId: string,
  ): Promise<ProPurchaseOutcome> => {
    if (!isConfigured || !storeQueryAvailable) return 'unavailable';
    // Only a product from the most recent offer fetch may be bought. A price
    // response that arrived late, or a plan the store has since stopped
    // returning, must not be able to authorize a charge against a figure the
    // screen is no longer showing.
    if (!purchasableProductIds.current.has(productId)) return 'unavailable';
    const android = Platform.OS === 'android';
    if (android && androidMoneyAction.current) return 'unavailable';
    const action = android ? { session: androidSessionGeneration.current } : null;
    if (action) {
      androidMoneyAction.current = action;
      // A query started before checkout cannot revoke the new purchase later.
      androidQueryGeneration.current += 1;
    }
    try {
      let result: Awaited<ReturnType<typeof purchase>> | null = null;
      try {
        result = await purchase(productId);
      } catch {
        // SDK failure is not an ownership answer. The Play query remains safe.
      }
      const playSnapshot = action ? await refreshAndroid(action) : null;
      if (!result) return 'failed';
      if (result.type === 'cancelled') return 'cancelled';
      // Deferred approval (Ask to Buy, a pending Play payment). Nothing is
      // entitled yet and nothing has failed; the store finishes it later.
      if (result.type === 'pending') return 'pending';
      if (result.type !== 'purchased') return 'failed';
      if (playSnapshot) {
        const sku = productId.split(':')[0];
        if (playSnapshot.pendingProductIds.includes(sku)) return 'pending';
        return playSnapshot.status === 'active' && playSnapshot.activeProductIds.includes(sku)
          ? 'purchased' : 'unconfirmed';
      }
      try {
        return (await verifyProEntitlement()) ? 'purchased' : 'unconfirmed';
      } catch {
        return 'unconfirmed';
      }
    } finally {
      if (action) finishAndroidAction(action);
    }
  }, [finishAndroidAction, isConfigured, purchase, refreshAndroid, storeQueryAvailable, verifyProEntitlement]);

  const value = useMemo<WafraBillingValue>(() => ({
    available: true,
    configured: isConfigured && storeQueryAvailable,
    configurationError: configurationError,
    subscriptionStatus: Platform.OS === 'android' ? androidSubscriptionStatus : statusLabel(subscriptionStatus),
    paywallStatus: proPlacement.state.status,
    onboardingFlowStatus: onboardingPlacement.state.status,
    fetchProOffers,
    purchasePro,
    presentProPaywall,
    presentOnboardingFlow,
    restorePro,
    refresh,
  }), [
    fetchProOffers,
    onboardingPlacement.state.status,
    presentOnboardingFlow,
    presentProPaywall,
    proPlacement.state.status,
    purchasePro,
    refresh,
    restorePro,
    configurationError,
    isConfigured,
    subscriptionStatus,
    androidSubscriptionStatus,
    storeQueryAvailable,
  ]);

  useEffect(() => {
    onValue?.(value);
  }, [onValue, value]);
  // Unmounted (Erase everything un-hydrates the store): its last value must
  // not stand in for the next runtime's.
  useEffect(() => () => onValue?.(null), [onValue]);

  return null;
}

/**
 * Hydrated with a storefront key, before the SDK is configured: what the
 * runtime itself reports until `isConfigured` (checkout and restore are not
 * offered yet, nothing is claimed about Pro, the stored Pro flag stands).
 */
function configuringBilling(configureNow: () => void): WafraBillingValue {
  return {
    ...unavailableBilling,
    available: true,
    presentProPaywall: async () => { throw new Error('SUPERWALL_NOT_CONFIGURED'); },
    presentOnboardingFlow: async () => { throw new Error('SUPERWALL_NOT_CONFIGURED'); },
    configureNow,
  };
}

/**
 * How long after an onboarded launch's first frames the SDK is configured.
 * Configuring preloads the paywalls (web views built on the main thread) and
 * re-checks entitlements; at launch that landed exactly as Home appeared.
 */
export const SUPERWALL_CONFIGURE_DELAY_MS = 2_000;

/**
 * Native monetization root. Superwall supplies storefront products, checkout,
 * restore and entitlements; Wafra's own `/pro` screen is the purchase UI. The
 * remote `pro_upgrade` paywall stays reachable for campaigns but is not what
 * the app presents when someone asks to subscribe.
 */
export function SuperwallBillingProvider({ children }: { children: React.ReactNode }) {
  const { state } = useStore();
  const deviceRegion = useLocales()[0]?.regionCode;
  const key = platformApiKey();
  const available = state.hydrated && key.length > 0;
  // First run configures at once (onboarding offers checkout); an onboarded
  // launch waits until Home has settled. Either way it happens once.
  const [configure, setConfigure] = useState(false);
  useEffect(() => {
    if (!available || configure) return;
    if (!state.onboarded) {
      setConfigure(true);
      return;
    }
    const task = runAfterFirstFrames(() => setConfigure(true), { delayMs: SUPERWALL_CONFIGURE_DELAY_MS });
    return () => task.cancel();
  }, [available, configure, state.onboarded]);
  const [runtimeValue, setRuntimeValue] = useState<WafraBillingValue | null>(null);
  useEffect(() => {
    if (!available) setRuntimeValue(null);
  }, [available]);
  const configuring = useMemo(() => configuringBilling(() => setConfigure(true)), []);
  const value = !available ? unavailableBilling : runtimeValue ?? configuring;
  const onConfigurationError = useCallback((error: Error) => {
    if (__DEV__) console.warn('[Superwall] configuration failed', error.message);
  }, []);
  const options = useMemo(() => ({
    // expo-superwall 1.4 configures once and has no runtime locale setter.
    // Read the real region before that configuration; never remount the SDK
    // to update locale. Wafra's own purchase UI follows the saved language.
    localeIdentifier: billingLocaleIdentifier(state.language, deviceRegion),
    eventTrackingBehavior: 'none' as const,
    isExternalDataCollectionEnabled: false,
    enableExperimentalDeviceVariables: false,
    shouldObservePurchases: true,
    paywalls: {
      // Off: preloading builds every campaign paywall's web view on the main
      // thread right after launch. Wafra's own /pro screen is the purchase UI
      // and buys and restores through the store directly (purchase,
      // restorePurchases), so nothing there waits on a preloaded paywall; a
      // campaign or onboarding placement loads its paywall when it is shown.
      shouldPreload: false,
      isHapticFeedbackEnabled: true,
    },
  }), [state.language, deviceRegion]);

  /*
    ONE tree shape for the app below, before and after hydration and before
    and after the SDK is configured. The app used to sit inside
    SuperwallProvider/SuperwallRuntime once `available` turned true and inside
    a bare context provider before, so hydration changed the element type at
    its position and React remounted everything under it (the router, the
    lock, onboarding, toasts) exactly as Home appeared. The SDK now sits beside
    the app and publishes its billing value up; only the value changes.
  */
  return (
    <>
      <LocalCaptureLeaseSync />
      {Platform.OS === 'android' && <ComplimentaryRefresh />}
      {available && configure ? (
        <SuperwallProvider
          apiKeys={{ ios: IOS_API_KEY, android: ANDROID_API_KEY }}
          options={options}
          onConfigurationError={onConfigurationError}>
          <SuperwallRuntime onValue={setRuntimeValue} />
        </SuperwallProvider>
      ) : null}
      <WafraBillingContext.Provider value={value}>
        {children}
      </WafraBillingContext.Provider>
    </>
  );
}
