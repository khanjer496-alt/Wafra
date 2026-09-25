import { workflowCopy } from '@/components/workflows/workflow-copy';
import { useLanguage } from '@/hooks/use-language';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import {
  useWafraBilling,
  type ProPlanOffer,
  type ProPurchaseOutcome,
} from '@/components/superwall-billing-context';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/controls';
import { Icon, type IconName } from '@/components/ui/icon';
import { Row, Section } from '@/components/ui/layout';
import { ScreenScaffold } from '@/components/ui/screen-scaffold';
import type { ScreenHeaderProps } from '@/components/ui/screen-header';
import { Radius, Spacing } from '@/constants/theme';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useTheme } from '@/hooks/use-theme';
import { t, tf } from '@/lib/i18n';
import { autoCaptureMethod, billingStore, trialDaysLeft, type ProPlan } from '@/lib/purchases';
import { proCopy } from '@/lib/pro-copy';
import { configuredPublicUrl } from '@/lib/public-links';
import { subscriptionManagementUrl } from '@/lib/billing';
import { useStore } from '@/lib/store';

type FeatureRow = {
  icon: IconName;
  title: string;
  text: string;
};

type BillingAction = 'purchase' | 'restore' | 'manage' | null;
type OfferState = 'loading' | 'ready' | 'unavailable';

/** Yearly first: it is the plan the screen recommends when the store has both. */
const PLAN_ORDER: ProPlan[] = ['yearly', 'monthly'];

/**
 * Only what Pro gates (see pro-copy.ts). Automatic capture everywhere; on
 * Android the bank-app notification reader and the past-SMS inbox import are
 * the same collect-without-asking feature. Insights and subscriptions are
 * free and are not listed.
 */
function features(copy: ReturnType<typeof proCopy>): FeatureRow[] {
  const rows: FeatureRow[] = [{
    icon: 'spark',
    title: t('featAutoTracking'),
    text: t(autoCaptureMethod() === 'localAutomation' ? 'featAutoTrackingIosText' : 'featAutoTrackingText'),
  }];
  if (autoCaptureMethod() === 'inboxScan') {
    rows.push(
      { icon: 'bank', title: copy.notificationsTitle, text: copy.notificationsText },
      { icon: 'calendar', title: copy.historyTitle, text: copy.historyText },
    );
  }
  return rows;
}

/**
 * Wafra's own Pro screen owns the subscription purchase.
 *
 * Superwall stays the storefront seam — it supplies the localized product
 * prices, runs the platform checkout sheet, restores purchases and answers for
 * the `pro` entitlement — but the surface a customer reads and taps is this
 * native, localized screen rather than a remote paywall. Every price on it is
 * the string the device's own store returned; a plan the store does not return
 * is shown as unavailable instead of being advertised at a guessed figure.
 */
export default function ProScreen() {
  const language = useLanguage();
  const words = workflowCopy(language);
  const copy = proCopy(language);
  const theme = useTheme();
  // At the accessibility sizes each row's icon sits above its text, so a long
  // word ("subscriptions") has the full width instead of breaking beside it.
  const largeText = useLargeTextLayout();
  const router = useRouter();
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
  const proHeader: ScreenHeaderProps = {
    title: t('wafraPro'),
    back: { label: t('back'), onPress: () => router.back() },
  };

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

  const publicLinkRow = (
    title: string,
    url: string | null,
    last = false,
  ) => {
    if (url) return (
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={title}
        hitSlop={8}
        onPress={() => void openLegal(url)}
        style={styles.legalLink}>
        <ThemedText type="meta" style={{ color: theme.primary }}>
          {title}
        </ThemedText>
      </Pressable>
    );
    return (
      <Row last={last}>
        <View style={[styles.featureText, largeText && styles.featureTextStacked]}>
          <ThemedText type="small">{title}</ThemedText>
          <ThemedText type="meta" themeColor="textTertiary">
            {t('publicLinkUnavailable')}
          </ThemedText>
        </View>
        <Icon name="alert" size={15} color={theme.warning} />
      </Row>
    );
  };

  const planRow = (offer: ProPlanOffer) => {
    const selected = offer.plan === selectedPlan;
    const label = offer.plan === 'yearly' ? t('yearly') : t('monthly');
    const period = offer.plan === 'yearly' ? t('perYear') : t('perMonth');
    return (
      <Pressable
        key={offer.productId}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        accessibilityLabel={`${label} · ${offer.priceString} ${period}`}
        testID={`pro-plan-${offer.plan}`}
        onPress={() => setSelectedPlan(offer.plan)}
        style={[
          styles.planRow,
          largeText && styles.planRowWrap,
          {
            borderColor: selected ? theme.primary : theme.controlBorder,
            borderWidth: selected ? 2 : 1,
            backgroundColor: selected ? theme.primarySoft : theme.backgroundElement,
          },
        ]}>
        <View
          style={[
            styles.planMark,
            { borderColor: selected ? theme.primary : theme.controlBorder },
          ]}>
          {selected && <View style={[styles.planDot, { backgroundColor: theme.primary }]} />}
        </View>
        <ThemedText type="smallBold" style={styles.featureText}>{label}</ThemedText>
        <View style={[styles.planPrice, largeText && styles.planPriceStacked]}>
          <ThemedText type="smallBold" tabular>{offer.priceString}</ThemedText>
          <ThemedText type="meta" themeColor="textSecondary">{period}</ThemedText>
        </View>
      </Pressable>
    );
  };

  /**
   * A plan the store did not return. It is drawn rather than dropped: a
   * catalogue missing one SKU is a storefront or configuration fault, and
   * silently showing a single plan hides it from the only person who can see
   * it happen. The row carries no price and cannot be selected.
   */
  const unavailablePlanRow = (plan: ProPlan) => (
    <View
      key={`unavailable-${plan}`}
      accessibilityRole="summary"
      style={[
        styles.planRow,
        largeText && styles.planRowWrap,
        { borderColor: theme.cardBorder, backgroundColor: theme.backgroundElement },
      ]}>
      <View style={[styles.featureText, largeText && styles.featureTextStacked]}>
        <ThemedText type="smallBold">{plan === 'yearly' ? t('yearly') : t('monthly')}</ThemedText>
        <ThemedText type="meta" themeColor="textTertiary">{t('priceUnavailable')}</ThemedText>
      </View>
      <Icon name="alert" size={16} color={theme.warning} />
    </View>
  );

  const retryPrices = (
    <Pressable accessibilityRole="button" onPress={() => void loadOffers()} hitSlop={8}>
      <ThemedText type="micro" style={{ color: theme.primary }}>{t('retryPrices')}</ThemedText>
    </Pressable>
  );

  return (
    <ScreenScaffold
      headerMode="native"
      header={proHeader}
      contentStyle={styles.content}
      scrollProps={{ showsVerticalScrollIndicator: false }}>
      <Section index={0} style={styles.hero}>
        <ThemedText type="title" accessibilityRole="header">{t('proOutcomeTitle')}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{words.proBody}</ThemedText>
        <ThemedText type="default" themeColor="textSecondary">
          {entitled
            ? t('proActiveThanks')
            : trial > 0
              ? tf('proTrialActiveBody', { left: trial, s: trial === 1 ? '' : 's' })
              : t('proTrialEndedBody')}
        </ThemedText>
        {!entitled && trial > 0 && (
          <View
            style={[
              styles.statusPill,
              { backgroundColor: theme.primarySoft, borderColor: theme.primaryBorder },
            ]}>
            <View style={[styles.statusDot, { backgroundColor: theme.primary }]} />
            <ThemedText type="nano" style={{ color: theme.primary }}>
              {tf('settingsTrialDays', { count: trial, s: trial === 1 ? '' : 's' })}
            </ThemedText>
          </View>
        )}
      </Section>

      <Section
        index={1}
        style={styles.featuresCard}>
        <ThemedText type="smallBold" accessibilityRole="header" style={styles.sectionLabel}>
          {t('proBenefitsTitle')}
        </ThemedText>
        {features(copy).map((feature, index, rows) => (
          <Row key={feature.title} last={index === rows.length - 1}>
            <View style={[styles.featureIcon, { backgroundColor: theme.primarySoft }]}>
              <Icon name={feature.icon} size={18} color={theme.primary} />
            </View>
            <View style={[styles.featureText, largeText && styles.featureTextStacked]}>
              <ThemedText type="small">{feature.title}</ThemedText>
              <ThemedText type="meta" themeColor="textSecondary">{feature.text}</ThemedText>
            </View>
          </Row>
        ))}
      </Section>

      {!entitled && (
        <Section index={2} style={styles.plans}>
          <ThemedText type="meta" themeColor="textTertiary">{t('proChoosePlan')}</ThemedText>
          {offerState === 'loading' ? (
            <ThemedText type="small" themeColor="textSecondary">{t('priceLoading')}</ThemedText>
          ) : offerState === 'ready' ? (
            <>
              {PLAN_ORDER.map((plan) => {
                const offer = offers.find((candidate) => candidate.plan === plan);
                return offer ? planRow(offer) : unavailablePlanRow(plan);
              })}
              {missingPlans.length > 0 && (
                <View style={[styles.featureText, largeText && styles.featureTextStacked]}>
                  <ThemedText type="meta" themeColor="textTertiary">
                    {t('priceUnavailableBody')}
                  </ThemedText>
                  {retryPrices}
                </View>
              )}
              {selectedOffer && (
                <ThemedText type="meta" themeColor="textTertiary">
                  {tf(
                    selectedPlan === 'yearly' ? 'proChargeTimingYear' : 'proChargeTimingMonth',
                    { price: selectedOffer.priceString },
                  )}
                </ThemedText>
              )}
              <ThemedText type="meta" themeColor="textTertiary">
                {store === 'appStore'
                  ? t('subscriptionRenewalTermsIos')
                  : store === 'play'
                    ? t('subscriptionRenewalTermsAndroid')
                    : t('proStoreConfirmsPrice')}
              </ThemedText>
            </>
          ) : (
            <View
              style={[
                styles.freeNote,
                largeText && styles.freeNoteLarge,
                { borderColor: theme.cardBorder, backgroundColor: theme.backgroundElement },
              ]}>
              <View style={styles.featureIcon}>
                <Icon name="alert" size={19} color={theme.warning} />
              </View>
              <View style={[styles.featureText, largeText && styles.featureTextStacked]}>
                <ThemedText type="small">
                  {checkoutReady ? t('priceUnavailable') : t('playOnlyTitle')}
                </ThemedText>
                <ThemedText type="meta" themeColor="textTertiary">
                  {checkoutReady ? t('priceUnavailableBody') : t('playOnlyBody')}
                </ThemedText>
                {checkoutReady && retryPrices}
              </View>
            </View>
          )}
        </Section>
      )}

      <Section index={3}>
        <View
          style={[
            styles.freeNote,
            largeText && styles.freeNoteLarge,
            { borderColor: theme.cardBorder, backgroundColor: theme.backgroundElement },
          ]}>
          <View style={styles.featureIcon}>
            <Icon name="check" size={19} color={theme.income} />
          </View>
          <View style={[styles.featureText, largeText && styles.featureTextStacked]}>
            <ThemedText type="small">{copy.freeTitle}</ThemedText>
            <ThemedText type="meta" themeColor="textSecondary">{copy.freeText}</ThemedText>
            <Pressable accessibilityRole="button" onPress={() => router.push('/import-sms')} hitSlop={8}>
              <ThemedText type="micro" style={{ color: theme.primary }}>{t('pasteBankMessage')}</ThemedText>
            </Pressable>
          </View>
        </View>
      </Section>

      {notice && (
        <View
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={[styles.notice, { borderColor: theme.cardBorder, backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="smallBold">{notice.title}</ThemedText>
          <ThemedText type="meta" themeColor="textSecondary">{notice.body}</ThemedText>
        </View>
      )}

      <View style={styles.actions}>
        {entitled ? (
          <>
            {!state.founderPro && Platform.OS !== 'web' && (
              <Button
                variant="outline"
                label={t('manageSubscription')}
                disabled={billingAction !== null}
                onPress={manage}
              />
            )}
            <Button variant="ghost" label={t('proContinue')} onPress={() => router.back()} />
          </>
        ) : (
          <>
            <Button
              label={billingAction === 'purchase'
                ? t('purchaseInProgress')
                : selectedOffer
                  ? tf('startPlanWithPrice', {
                      plan: selectedPlan === 'yearly' ? t('yearly') : t('monthly'),
                      price: selectedOffer.priceString,
                    })
                  : t('getPro')}
              disabled={billingAction !== null}
              onPress={() => void buySelectedPlan()}
            />
            <Button
              variant="ghost"
              label={t('restorePurchase')}
              disabled={billingAction !== null}
              onPress={() => void restore()}
            />
          </>
        )}
      </View>

      <View style={[styles.legalLinks, { borderColor: theme.cardBorder }]}>
        {publicLinkRow(t('privacyPolicy'), privacyPolicyUrl)}
        {publicLinkRow(t('termsOfUse'), termsOfUseUrl, true)}
      </View>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.four },
  hero: { alignItems: 'flex-start', gap: Spacing.two, paddingTop: Spacing.two },
  featuresCard: { gap: Spacing.one },
  sectionLabel: { marginBottom: Spacing.two },
  featureIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: { flex: 1, gap: 3 },
  featureTextStacked: { flexBasis: '100%' },
  plans: { gap: Spacing.two },
  planMark: {
    width: 22,
    height: 22,
    borderRadius: Radius.full,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planDot: { width: 10, height: 10, borderRadius: Radius.full },
  planPrice: { alignItems: 'flex-end', gap: 2 },
  // The price drops under the plan name at the accessibility sizes.
  planRowWrap: { flexWrap: 'wrap' },
  planPriceStacked: { flexBasis: '100%', alignItems: 'flex-start', paddingStart: 22 + Spacing.three },
  planRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: Radius.sheet,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  statusPill: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.three,
  },
  statusDot: { width: 7, height: 7, borderRadius: Radius.full },
  // Icon above the text and a tighter inset at the accessibility sizes, so a
  // long word has the card's full width.
  freeNoteLarge: { flexWrap: 'wrap', padding: Spacing.three },
  freeNote: {
    flexDirection: 'row',
    gap: Spacing.three,
    padding: Spacing.four,
    borderRadius: Radius.sheet,
    borderWidth: StyleSheet.hairlineWidth,
  },
  notice: {
    gap: Spacing.one,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sheet,
    padding: Spacing.three,
  },
  actions: { gap: Spacing.two },
  legalLinks: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sheet,
    overflow: 'hidden',
    marginBottom: Spacing.four,
  },
  legalLink: {
    minHeight: 46,
    paddingHorizontal: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
