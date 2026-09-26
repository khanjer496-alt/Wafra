/**
 * E9 · The paywall (ink), with the person's pattern behind it.
 *
 * It sells exactly what Pro gates — capture that runs by itself — tied to
 * what they just set up (their watched category's limit, their reminders),
 * and it is honest about the trial: Wafra's own free days from first launch,
 * no card, and at the end automatic capture pauses, nothing is charged and
 * the ledger stays (purchases.ts). No "we remind you" step: the app sends no
 * trial-ending reminder, so none is promised.
 *
 * Plans come from the real billing layer (Superwall via useWafraBilling):
 * the storefront's own price strings, the same purchase call, legal-link and
 * outcome handling as the Pro screen. A plan the store did not return is
 * shown as unavailable, never at a guessed price. "Start the free N days"
 * is always there and never needs the store.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EBody, EHeadline, EStepFrame, ETextAction, fitPatternTile } from '@/components/onboarding/e-frame';
import { useWafraBilling, type ProPlanOffer, type ProPurchaseOutcome } from '@/components/superwall-billing-context';
import { ThemedText } from '@/components/themed-text';
import { EButton } from '@/components/ui/band/e-button';
import { PatternMosaic } from '@/components/ui/pattern-mosaic';
import type { BandPalette } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { t, tf } from '@/lib/i18n';
import { trialTimeline } from '@/lib/onboarding-e';
import { onboardingECopy } from '@/lib/onboarding-e-copy';
import type { PatternTile } from '@/lib/pattern';
import { configuredPublicUrl } from '@/lib/public-links';
import { billingStore, type ProPlan } from '@/lib/purchases';

const PLAN_ORDER: ProPlan[] = ['yearly', 'monthly'];

type Notice = { title: string; body: string } | null;

/**
 * The Pro screen's purchase rules, for onboarding: refuse before the store is
 * asked when the legal links or the storefront are missing, and report the
 * store's answer literally — a cancellation is not a failure, a deferred
 * approval is not a purchase.
 */
function useOnboardingCheckout(enabled: boolean, onPurchased: () => void) {
  const billing = useWafraBilling();
  const billingRef = useRef(billing);
  billingRef.current = billing;
  const checkoutReady = billing.available && billing.configured;
  const [offers, setOffers] = useState<ProPlanOffer[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [plan, setPlan] = useState<ProPlan>('yearly');
  const [busy, setBusy] = useState<'purchase' | 'restore' | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const latch = useRef(false);
  const request = useRef(0);
  const legalReady = configuredPublicUrl('privacyPolicyUrl') !== null && configuredPublicUrl('termsOfUseUrl') !== null;

  const load = useCallback(async () => {
    if (!enabled || !checkoutReady) { setState('unavailable'); return; }
    const id = ++request.current;
    setState('loading');
    setOffers([]);
    const loaded = await billingRef.current.fetchProOffers().catch(() => [] as ProPlanOffer[]);
    if (id !== request.current) return;
    setOffers(loaded);
    setState(loaded.length > 0 ? 'ready' : 'unavailable');
    setPlan((current) => loaded.some((offer) => offer.plan === current) ? current : loaded[0]?.plan ?? current);
  }, [checkoutReady, enabled]);

  useEffect(() => {
    void load();
    return () => { request.current += 1; };
  }, [load]);

  const selected = state === 'ready' ? offers.find((offer) => offer.plan === plan) ?? null : null;

  const purchase = async () => {
    if (latch.current) return;
    setNotice(null);
    if (!legalReady) { setNotice({ title: t('purchaseUnavailable'), body: t('purchaseLegalMissingBody') }); return; }
    if (!checkoutReady) {
      setNotice({ title: t('purchaseUnavailable'), body: billing.configurationError ? t('purchaseFailedBody') : t('playOnlyBody') });
      return;
    }
    if (!selected) { setNotice({ title: t('priceUnavailable'), body: t('priceUnavailableBody') }); return; }
    latch.current = true;
    setBusy('purchase');
    let outcome: ProPurchaseOutcome;
    try {
      outcome = await billing.purchasePro(selected.productId);
    } catch {
      outcome = 'failed';
    } finally {
      latch.current = false;
      setBusy(null);
    }
    if (outcome === 'cancelled') return;
    if (outcome === 'purchased') { onPurchased(); return; }
    if (outcome === 'pending') { setNotice({ title: t('purchasePendingTitle'), body: t('purchasePendingBody') }); return; }
    if (outcome === 'unavailable') { setNotice({ title: t('purchaseUnavailable'), body: t('playOnlyBody') }); return; }
    setNotice({ title: t('purchaseFailed'), body: t('purchaseFailedBody') });
  };

  const restore = async () => {
    if (latch.current) return;
    setNotice(null);
    if (!checkoutReady) { setNotice({ title: t('restoreFailed'), body: t('restoreFailedBody') }); return; }
    latch.current = true;
    setBusy('restore');
    let restored: boolean | null;
    try {
      restored = await billing.restorePro();
    } catch {
      restored = null;
    } finally {
      latch.current = false;
      setBusy(null);
    }
    if (restored === null) setNotice({ title: t('restoreFailed'), body: t('restoreFailedBody') });
    else if (!restored) setNotice({ title: t('noPurchaseFound'), body: t('noPurchaseFoundBody') });
    else onPurchased();
  };

  return { checkoutReady, offers, state, plan, setPlan, selected, busy, notice, setNotice, purchase, restore, load };
}

function PlanCard({ offer, plan, selected, onPress, palette }: {
  offer: ProPlanOffer | null;
  plan: ProPlan;
  selected: boolean;
  onPress: () => void;
  palette: BandPalette;
}) {
  const words = onboardingECopy(useLanguage());
  const label = plan === 'yearly' ? words.planYearly : words.planMonthly;
  const period = plan === 'yearly' ? t('perYear') : t('perMonth');
  if (!offer) {
    return <View accessible accessibilityLabel={`${label}. ${t('priceUnavailable')}`}
      style={[styles.plan, { borderColor: palette.bandRule }]} testID={`onboarding-plan-${plan}-unavailable`}>
      <ThemedText type="smallBold" style={{ color: palette.onBand }}>{label}</ThemedText>
      <ThemedText type="meta" style={{ color: palette.onBandSecondary }}>{t('priceUnavailable')}</ThemedText>
    </View>;
  }
  return <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }}
    accessibilityLabel={`${label} · ${offer.priceString} ${period}`} testID={`onboarding-plan-${plan}`}
    onPress={onPress}
    style={({ pressed }) => [styles.plan, {
      borderColor: selected ? palette.accent : palette.bandRule,
      borderWidth: selected ? 2 : 1.5,
      backgroundColor: selected ? palette.tile : 'transparent',
      opacity: pressed ? 0.85 : 1,
    }]}>
    <View style={[styles.radio, { borderColor: selected ? palette.accent : palette.onBandSecondary }]}>
      {selected ? <View style={[styles.radioDot, { backgroundColor: palette.accent }]} /> : null}
    </View>
    <ThemedText type="smallBold" style={{ color: palette.onBand }}>{label}</ThemedText>
    <ThemedText type="small" tabular style={{ color: palette.onBand }}>{offer.priceString}</ThemedText>
    <ThemedText type="meta" style={{ color: palette.onBandSecondary }}>{period}</ThemedText>
  </Pressable>;
}

export function PaywallStep({ tiles, watchedCategory, remindersOn, trialDays, captureOn, onFinish, onBack, onClose, preview, finishing }: {
  tiles: readonly PatternTile[];
  /** The first watched category's name, if they set a limit. */
  watchedCategory: string | null;
  /** Whether notifications for reminders were allowed. */
  remindersOn: boolean;
  /** Whole free days left (trialDaysLeft), 0 when the trial is over. */
  trialDays: number;
  /** Whether automatic capture is actually on for this person right now. */
  captureOn: boolean;
  /** Leave onboarding: after a purchase, a restore, or the free days. */
  onFinish: () => void;
  onBack?: () => void;
  onClose?: () => void;
  /** The Settings preview never buys. */
  preview: boolean;
  finishing: boolean;
}) {
  const words = onboardingECopy(useLanguage());
  const band = useBand('home');
  const largeText = useLargeTextLayout();
  const tile = fitPatternTile(useWindowDimensions().width, 52);
  const insets = useSafeAreaInsets();
  const checkout = useOnboardingCheckout(!preview, onFinish);
  const timeline = trialTimeline(trialDays);
  const store = billingStore();
  const privacyUrl = configuredPublicUrl('privacyPolicyUrl');
  const termsUrl = configuredPublicUrl('termsOfUseUrl');
  const busy = checkout.busy !== null || finishing;
  const openLegal = (url: string) => {
    void Linking.openURL(url).catch(() => checkout.setNotice({ title: t('legalLinkFailed'), body: t('legalLinkFailedBody') }));
  };
  return <View style={styles.root}>
    <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants"
      style={[styles.behind, { top: insets.top + 56 }]}>
      <PatternMosaic tiles={tiles} tile={tile} style={{ opacity: 0.4 }} accessibilityLabel="" />
    </View>
    <EStepFrame palette={band} step={null} onBack={onBack} onClose={onClose} backDisabled={busy} testID="onboarding-paywall"
      contentStyle={styles.content}
      footer={<>
        {checkout.state !== 'unavailable' ? <EButton palette={band}
          color={{ fill: band.accent, text: band.onAccent }}
          label={checkout.busy === 'purchase' ? t('purchaseInProgress') : words.continuePro}
          onPress={() => void checkout.purchase()} disabled={busy || preview || !checkout.selected} busy={checkout.busy === 'purchase'}
          testID="onboarding-paywall-pro" /> : null}
        <ETextAction palette={band} label={trialDays > 0 ? words.startFree(trialDays) : words.continueFree}
          onPress={onFinish} disabled={busy} testID="onboarding-paywall-free" />
        {Platform.OS !== 'web' && !preview ? <ETextAction palette={band} label={t('restorePurchase')}
          onPress={() => void checkout.restore()} disabled={busy} testID="onboarding-paywall-restore" /> : null}
      </>}>
      <EHeadline palette={band} size={42}>{words.paywallTitle}</EHeadline>
      <EBody palette={band}>{words.paywallBody(watchedCategory, remindersOn)}</EBody>
      {timeline.length > 0 ? <View style={[styles.timeline, largeText && styles.stacked]} accessible
        accessibilityLabel={`${words.trialTimelineLabel}. ${words.trialToday}: ${captureOn ? words.trialTodayBody : words.trialTodayBodyOff} ${words.trialEnd(timeline[1]!.day)}: ${words.trialEndBody}`}
        testID="onboarding-trial-timeline">
        <View style={[styles.stage, { backgroundColor: band.tile }]}>
          <ThemedText type="smallBold" style={{ color: band.accent }}>{words.trialToday}</ThemedText>
          <ThemedText type="meta" style={{ color: band.onBand }}>{captureOn ? words.trialTodayBody : words.trialTodayBodyOff}</ThemedText>
        </View>
        <View style={[styles.stage, { backgroundColor: band.tile }]}>
          <ThemedText type="smallBold" style={{ color: band.onBand }}>{words.trialEnd(timeline[1]!.day)}</ThemedText>
          <ThemedText type="meta" style={{ color: band.onBand }}>{words.trialEndBody}</ThemedText>
        </View>
      </View> : null}
      {checkout.state === 'loading' ? <ThemedText type="meta" style={{ color: band.onBandSecondary }}>{t('priceLoading')}</ThemedText>
        : checkout.state === 'ready' ? <>
          <View style={[styles.plans, largeText && styles.stacked]} accessibilityRole="radiogroup" testID="onboarding-plans">
            {PLAN_ORDER.map((plan) => <PlanCard key={plan} plan={plan} palette={band}
              offer={checkout.offers.find((offer) => offer.plan === plan) ?? null}
              selected={checkout.plan === plan} onPress={() => checkout.setPlan(plan)} />)}
          </View>
          {checkout.selected ? <ThemedText type="micro" style={{ color: band.onBandSecondary }}>
            {tf(checkout.plan === 'yearly' ? 'proChargeTimingYear' : 'proChargeTimingMonth', { price: checkout.selected.priceString })}
            {' '}
            {store === 'appStore' ? t('subscriptionRenewalTermsIos') : store === 'play' ? t('subscriptionRenewalTermsAndroid') : t('proStoreConfirmsPrice')}
          </ThemedText> : null}
        </> : <ThemedText type="meta" style={{ color: band.onBandSecondary }} testID="onboarding-plans-unavailable">
          {checkout.checkoutReady ? t('priceUnavailableBody') : t('playOnlyBody')}
        </ThemedText>}
      {checkout.notice ? <View accessibilityRole="alert" accessibilityLiveRegion="polite"
        style={[styles.notice, { backgroundColor: band.sheet }]} testID="onboarding-paywall-notice">
        <ThemedText type="smallBold" style={{ color: band.text }}>{checkout.notice.title}</ThemedText>
        <ThemedText type="meta" style={{ color: band.textSecondary }}>{checkout.notice.body}</ThemedText>
      </View> : null}
      {privacyUrl || termsUrl ? <View style={styles.legal}>
        {privacyUrl ? <Pressable accessibilityRole="link" accessibilityLabel={t('privacyPolicy')} hitSlop={8}
          onPress={() => openLegal(privacyUrl)} style={styles.legalLink}>
          <ThemedText type="micro" style={{ color: band.onBand }}>{t('privacyPolicy')}</ThemedText>
        </Pressable> : null}
        {termsUrl ? <Pressable accessibilityRole="link" accessibilityLabel={t('termsOfUse')} hitSlop={8}
          onPress={() => openLegal(termsUrl)} style={styles.legalLink}>
          <ThemedText type="micro" style={{ color: band.onBand }}>{t('termsOfUse')}</ThemedText>
        </Pressable> : null}
      </View> : null}
    </EStepFrame>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, width: '100%' },
  behind: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  content: { paddingTop: 150 },
  timeline: { flexDirection: 'row', gap: 8 },
  stacked: { flexDirection: 'column' },
  stage: { flex: 1, borderRadius: 16, padding: 12, gap: 4 },
  plans: { flexDirection: 'row', gap: 8 },
  plan: { flex: 1, minHeight: 112, borderRadius: 20, padding: 14, gap: 4, borderWidth: 1.5 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  notice: { borderRadius: 16, padding: 14, gap: 4 },
  legal: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  legalLink: { minHeight: 44, justifyContent: 'center' },
});
