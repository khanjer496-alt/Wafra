/**
 * The Pro checkout, shared by the Pro screen and the in-context Pro sheet.
 *
 * Moved verbatim out of pro.tsx so the sheet that opens over Settings runs
 * the SAME storefront path — the same offers fetch, the same single-flight
 * latch, the same literal reading of the store's answer — rather than a
 * second copy that could drift. Superwall stays the storefront seam: it
 * supplies the localized prices, runs the platform checkout sheet, restores
 * purchases and answers for the `pro` entitlement. Every price shown is the
 * string the device's own store returned; a plan the store does not return
 * is unavailable, never advertised at a guessed figure.
 *
 * The four action bodies (buySelectedPlan, restore, manage, openLegal) are
 * fingerprinted in scripts/test/workflows/protected-handlers.json.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';

import {
  useWafraBilling,
  type ProPlanOffer,
  type ProPurchaseOutcome,
} from '@/components/superwall-billing-context';
import { subscriptionManagementUrl } from '@/lib/billing';
import { t } from '@/lib/i18n';
import { billingStore, trialDaysLeft, type ProPlan } from '@/lib/purchases';
import { configuredPublicUrl } from '@/lib/public-links';
import { useStore } from '@/lib/store';

export type BillingAction = 'purchase' | 'restore' | 'manage' | null;
export type OfferState = 'loading' | 'ready' | 'unavailable';

/** Yearly first: it is the plan the screen recommends when the store has both. */
export const PLAN_ORDER: ProPlan[] = ['yearly', 'monthly'];

export function useProCheckout() {
  const { state } = useStore();
  const billing = useWafraBilling();
  const [billingAction, setBillingAction] = useState<BillingAction>(null);
  const [offers, setOffers] = useState<ProPlanOffer[]>([]);
  const [offerState, setOfferState] = useState<OfferState>('loading');
  const [selectedPlan, setSelectedPlan] = useState<ProPlan>('yearly');
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null);
  const offerRequest = useRef(0);
  // `billingAction` is React state, so it is not visible to a second tap that
  // lands in the same frame. A money action needs a guard that closes on the
  // first call, not on the next render.
  const actionLatch = useRef(false);
  const trial = trialDaysLeft(state);
  const entitled = state.pro || state.founderPro;
  const privacyPolicyUrl = configuredPublicUrl('privacyPolicyUrl');
  const termsOfUseUrl = configuredPublicUrl('termsOfUseUrl');
  const legalReady = privacyPolicyUrl !== null && termsOfUseUrl !== null;
  const store = billingStore();
  const checkoutReady = billing.available && billing.configured;

  // Read through a ref so a new billing snapshot (a status refresh, a customer
  // info event) cannot restart a price fetch that is already in flight.
  const billingRef = useRef(billing);
  billingRef.current = billing;

  const loadOffers = useCallback(async () => {
    if (entitled || !checkoutReady) {
      setOfferState('unavailable');
      return;
    }
    const request = ++offerRequest.current;
    setOfferState('loading');
    // Drop what the last fetch returned before asking again. A price left on
    // screen while its refresh is in flight is a price the CTA could still
    // charge, and the storefront it came from may no longer be this one.
    setOffers([]);
    const loaded = await billingRef.current.fetchProOffers();
    if (request !== offerRequest.current) return;
    setOffers(loaded);
    setOfferState(loaded.length > 0 ? 'ready' : 'unavailable');
    setSelectedPlan((current) =>
      loaded.some((offer) => offer.plan === current) ? current : loaded[0]?.plan ?? current);
  }, [checkoutReady, entitled]);

  useEffect(() => {
    void loadOffers();
    return () => { offerRequest.current += 1; };
  }, [loadOffers]);

  const selectedOffer = offerState === 'ready'
    ? offers.find((offer) => offer.plan === selectedPlan) ?? null
    : null;
  const missingPlans = PLAN_ORDER.filter(
    (plan) => !offers.some((offer) => offer.plan === plan));

  /**
   * The one action that can charge money. It refuses before the store is asked
   * when the required legal links or the storefront itself are missing, and it
   * reports the store's answer literally: a cancellation is not a failure, a
   * deferred approval is not a purchase, and a completed transaction that the
   * `pro` entitlement has not confirmed says so rather than claiming Pro.
   */
  const buySelectedPlan = useCallback(async () => {
    if (actionLatch.current) return;
    setNotice(null);
    if (!legalReady) {
      setNotice({ title: t('purchaseUnavailable'), body: t('purchaseLegalMissingBody') });
      return;
    }
    if (!checkoutReady) {
      setNotice({
        title: t('purchaseUnavailable'),
        body: billing.configurationError ? t('purchaseFailedBody') : t('playOnlyBody'),
      });
      return;
    }
    if (!selectedOffer) {
      setNotice({ title: t('priceUnavailable'), body: t('priceUnavailableBody') });
      return;
    }
    actionLatch.current = true;
    setBillingAction('purchase');
    let outcome: ProPurchaseOutcome;
    try {
      outcome = await billing.purchasePro(selectedOffer.productId);
    } finally {
      actionLatch.current = false;
      setBillingAction(null);
    }
    if (outcome === 'cancelled') return;
    if (outcome === 'purchased') {
      setNotice({ title: t('proPurchaseSuccessTitle'), body: t('proPurchaseSuccessBody') });
      return;
    }
    if (outcome === 'pending') {
      setNotice({ title: t('purchasePendingTitle'), body: t('purchasePendingBody') });
      return;
    }
    if (outcome === 'unavailable') {
      setNotice({ title: t('purchaseUnavailable'), body: t('playOnlyBody') });
      return;
    }
    setNotice({ title: t('purchaseFailed'), body: t('purchaseFailedBody') });
  }, [billing, checkoutReady, legalReady, selectedOffer]);

  const restore = async () => {
    if (actionLatch.current) return;
    setNotice(null);
    if (!checkoutReady) {
      setNotice({ title: t('restoreFailed'), body: t('restoreFailedBody') });
      return;
    }
    actionLatch.current = true;
    setBillingAction('restore');
    let restored: boolean | null;
    try {
      restored = await billing.restorePro();
    } finally {
      actionLatch.current = false;
      setBillingAction(null);
    }
    if (restored === null) {
      setNotice({ title: t('restoreFailed'), body: t('restoreFailedBody') });
    } else if (!restored) {
      setNotice({ title: t('noPurchaseFound'), body: t('noPurchaseFoundBody') });
    } else {
      setNotice({ title: t('proRestoreSuccessTitle'), body: t('proRestoreSuccessBody') });
    }
  };

  const manage = async () => {
    if (actionLatch.current) return;
    setNotice(null);
    actionLatch.current = true;
    setBillingAction('manage');
    const url = await subscriptionManagementUrl();
    try {
      if (!url || !(await Linking.canOpenURL(url))) {
        setNotice({ title: t('manageSubscriptionFailed'), body: t('manageSubscriptionFailedBody') });
        return;
      }
      await Linking.openURL(url);
    } catch {
      setNotice({ title: t('manageSubscriptionFailed'), body: t('manageSubscriptionFailedBody') });
    } finally {
      actionLatch.current = false;
      setBillingAction(null);
    }
  };

  const openLegal = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      setNotice({ title: t('legalLinkFailed'), body: t('legalLinkFailedBody') });
    }
  };

  return {
    state,
    billing,
    billingAction,
    offers,
    offerState,
    selectedPlan,
    setSelectedPlan,
    selectedOffer,
    missingPlans,
    notice,
    trial,
    entitled,
    privacyPolicyUrl,
    termsOfUseUrl,
    store,
    checkoutReady,
    loadOffers,
    buySelectedPlan,
    restore,
    manage,
    openLegal,
  };
}

export type ProCheckout = ReturnType<typeof useProCheckout>;
