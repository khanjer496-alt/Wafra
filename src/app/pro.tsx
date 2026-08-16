import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/controls';
import { Icon, type IconName } from '@/components/ui/icon';
import { Row, ScreenHeader, Section } from '@/components/ui/layout';
import { MaxContentWidth, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { alignEnd, t, tf } from '@/lib/i18n';
import {
  autoCaptureMethod,
  PRO_PRICES,
  PRO_REFERENCE_PRICE_STRINGS,
  trialDaysLeft,
  type ProPlan,
} from '@/lib/purchases';
import {
  isBillingAvailable,
  loadStorePrices,
  purchasePro,
  restorePro,
  subscriptionManagementUrl,
  type StorePrices,
} from '@/lib/billing';
import { useStore } from '@/lib/store';

type FeatureRow = {
  icon: IconName;
  titleKey: Parameters<typeof t>[0];
  textKey: Parameters<typeof t>[0];
};

type PriceStatus = 'unavailable' | 'loading' | 'ready' | 'failed';
type BillingAction = 'buy' | 'restore' | 'manage' | null;
type Completion = 'purchase' | 'restore' | null;

function configuredUrl(key: 'privacyPolicyUrl' | 'termsOfUseUrl'): string | null {
  const extra = Constants.expoConfig?.extra as Record<string, unknown> | undefined;
  const value = extra?.[key];
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * The list is built per platform, because the same feature is delivered two
 * different ways and describing the iPhone one as "reads your bank SMS" would
 * promise something Apple forbids. A paywall that oversells is the most
 * expensive copy in an app: the refund happens on the App Store review page.
 */
function features(): FeatureRow[] {
  return [
    {
      icon: 'spark',
      titleKey: 'featAutoTracking',
      textKey:
        autoCaptureMethod() === 'relayCapture' ? 'featAutoTrackingIosText' : 'featAutoTrackingText',
    },
  ];
}

/**
 * Wafra Pro paywall. Purchases run through the platform's own billing on a
 * store build — Play Billing on Android, StoreKit on iPhone. Side-load builds
 * explain why a purchase cannot be completed there.
 *
 * The screen also states what is NOT behind this wall. Wafra sells the work it
 * does on its own; handing it a message yourself stays free on both platforms,
 * and saying so here is what keeps the wall from reading as a hostage note to
 * an iPhone user who cannot use the automatic path yet.
 */
export default function ProScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { state, setPro } = useStore();
  const [plan, setPlan] = useState<ProPlan>('yearly');
  const [storePrices, setStorePrices] = useState<StorePrices | null>(null);
  const billingAvailable = isBillingAvailable();
  const [priceStatus, setPriceStatus] = useState<PriceStatus>(
    billingAvailable ? 'loading' : 'unavailable',
  );
  const [priceRequest, setPriceRequest] = useState(0);
  const [billingAction, setBillingAction] = useState<BillingAction>(null);
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null);
  const [completion, setCompletion] = useState<Completion>(null);
  const trial = trialDaysLeft(state);
  const rows = features();
  const privacyPolicyUrl = configuredUrl('privacyPolicyUrl');
  const termsOfUseUrl = configuredUrl('termsOfUseUrl');
  const legalReady = privacyPolicyUrl !== null && termsOfUseUrl !== null;

  useEffect(() => {
    if (!billingAvailable) return;
    let live = true;
    setPriceStatus('loading');
    void loadStorePrices().then((prices) => {
      if (!live) return;
      setStorePrices(prices);
      if (!prices) {
        setPriceStatus('failed');
        return;
      }
      setPriceStatus('ready');
      setPlan((current) =>
        prices[current] ? current : prices.yearly ? 'yearly' : 'monthly',
      );
    });
    return () => {
      live = false;
    };
  }, [billingAvailable, priceRequest]);

  const savingPercent = useMemo(() => {
    const monthly = storePrices?.monthly;
    const yearly = storePrices?.yearly;
    if (monthly && yearly && monthly.currencyCode === yearly.currencyCode) {
      const fullYear = monthly.price * 12;
      if (fullYear <= 0 || yearly.price >= fullYear) return null;
      return Math.floor((1 - yearly.price / fullYear) * 100);
    }
    if (Platform.OS !== 'web') return null;
    const fullYear = PRO_PRICES.monthly.fils * 12;
    return Math.floor((1 - PRO_PRICES.yearly.fils / fullYear) * 100);
  }, [storePrices]);

  const displayPrice = (candidate: ProPlan): string =>
    storePrices?.[candidate]?.priceString ??
    (Platform.OS === 'web'
      ? PRO_REFERENCE_PRICE_STRINGS[candidate]
      : t(priceStatus === 'loading' ? 'priceLoading' : 'priceUnavailable'));

  const selectedStorePrice = storePrices?.[plan]?.priceString ?? null;

  /**
   * What the last tap on Get Pro or Restore had to say.
   *
   * Every one of these answers was an `Alert.alert`, and `isBillingAvailable()`
   * is false on the web export — where `Alert.alert` is an empty method. So on
   * the one build the end-to-end suite drives, the two buttons on the screen
   * that sells the product did nothing, said nothing and logged nothing.
   *
   * It is drawn in the persistent purchase region rather than over the screen:
   * none of these outcomes asks the user to decide anything, so none of them
   * has earned a modal. What it has to do is stay visible, which an alert did
   * not reliably do in the web preview or after a store sheet closes.
   */
  const buy = async () => {
    if (billingAction) return;
    setNotice(null);
    if (!billingAvailable) {
      setNotice({ title: t('playOnlyTitle'), body: t('playOnlyBody') });
      return;
    }
    if (!legalReady) {
      setNotice({ title: t('purchaseUnavailable'), body: t('purchaseLegalMissingBody') });
      return;
    }
    if (!storePrices?.[plan]) {
      setNotice({ title: t('priceUnavailable'), body: t('priceUnavailableBody') });
      return;
    }
    setBillingAction('buy');
    try {
      const outcome = await purchasePro(plan);
      if (outcome === 'granted') {
        setPro(true);
        setCompletion('purchase');
      }
      // 'cancelled' is the user closing the sheet, and gets no dialogue —
      // telling someone their own decision failed is noise. 'failed' is the
      // store: an unactivated SKU, an SDK that would not configure, a throw.
      // Without this branch the button was simply inert forever, which reads as
      // a broken app rather than a broken listing.
      else if (outcome === 'failed')
        setNotice({ title: t('purchaseFailed'), body: t('purchaseFailedBody') });
    } finally {
      setBillingAction(null);
    }
  };

  const restore = async () => {
    if (billingAction) return;
    setNotice(null);
    if (!isBillingAvailable()) {
      setNotice({ title: t('nothingToRestore'), body: t('nothingToRestoreBody') });
      return;
    }
    setBillingAction('restore');
    try {
      const restored = await restorePro();
      if (restored) {
        setPro(true);
        setCompletion('restore');
      }
      // null is "could not ask the store", NOT "never paid". A subscriber
      // reinstalling on a bad connection must not be told their purchase does
      // not exist — they should be told to try again.
      else if (restored === null)
        setNotice({ title: t('restoreFailed'), body: t('restoreFailedBody') });
      else setNotice({ title: t('noPurchaseFound'), body: t('noPurchaseFoundBody') });
    } finally {
      setBillingAction(null);
    }
  };

  const manage = async () => {
    if (billingAction) return;
    setBillingAction('manage');
    setNotice(null);
    try {
      const url = await subscriptionManagementUrl();
      if (!url) {
        setNotice({ title: t('manageSubscriptionFailed'), body: t('manageSubscriptionFailedBody') });
        return;
      }
      await Linking.openURL(url);
    } catch {
      setNotice({ title: t('manageSubscriptionFailed'), body: t('manageSubscriptionFailedBody') });
    } finally {
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

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.headerWrap}>
          <ScreenHeader title={t('wafraPro')} onBack={() => router.back()} />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}>
          <Section index={0} style={styles.hero}>
            <View style={[styles.heroMark, { backgroundColor: theme.primarySoft }]}>
              <Icon name="spark" size={24} color={theme.primary} />
            </View>
            <ThemedText type="meta" style={{ color: theme.primary }}>
              {t('wafraPro')}
            </ThemedText>
            <ThemedText type="title">{t('proOutcomeTitle')}</ThemedText>
            <ThemedText type="default" themeColor="textSecondary">
              {state.pro
                ? t('proActiveThanks')
                : trial > 0
                  ? tf('proTrialActiveBody', {
                      left: trial,
                      s: trial === 1 ? '' : 's',
                    })
                  : t('proTrialEndedBody')}
            </ThemedText>
            {!state.pro && trial > 0 && (
              <View
                style={[
                  styles.statusPill,
                  { backgroundColor: theme.primarySoft, borderColor: theme.primaryBorder },
                ]}>
                <View style={[styles.statusDot, { backgroundColor: theme.primary }]} />
                <ThemedText type="nano" style={{ color: theme.primary }}>
                  {tf('settingsTrialDays', {
                    count: trial,
                    s: trial === 1 ? '' : 's',
                  })}
                </ThemedText>
              </View>
            )}
          </Section>

          <Section index={1}>
            <ThemedText type="meta" themeColor="textTertiary" style={styles.sectionLabel}>
              {t('proBenefitsTitle')}
            </ThemedText>
            {rows.map((f, i) => (
              <Row key={f.titleKey} last={i === rows.length - 1}>
                <View style={[styles.featureIcon, { backgroundColor: theme.backgroundSelected }]}>
                  <Icon name={f.icon} size={18} color={theme.textSecondary} />
                </View>
                <View style={styles.featureText}>
                  <ThemedText type="small">{t(f.titleKey)}</ThemedText>
                  <ThemedText type="meta" themeColor="textTertiary">
                    {t(f.textKey)}
                  </ThemedText>
                </View>
              </Row>
            ))}
          </Section>

          {/* What the wall does NOT hold back. It belongs on the paywall rather
              than only in a help page: the trial ends on the day this screen
              matters most, and a user who thinks Wafra has stopped working
              deletes it instead of pasting one message. */}
          <Section index={2}>
            <View
              style={[
                styles.freeNote,
                { borderColor: theme.cardBorder, backgroundColor: theme.backgroundElement },
              ]}>
              <View style={styles.featureIcon}>
                <Icon name="check" size={19} color={theme.income} />
              </View>
              <View style={styles.featureText}>
                <ThemedText type="small">{t('featPasteFree')}</ThemedText>
                <ThemedText type="meta" themeColor="textTertiary">
                  {t('featPasteFreeText')}
                </ThemedText>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push('/import-sms')}
                  hitSlop={8}>
                  <ThemedText type="micro" style={{ color: theme.primary }}>
                    {t('pasteBankMessage')}
                  </ThemedText>
                </Pressable>
              </View>
            </View>
          </Section>

          {!state.pro && (
            <Section index={3} style={styles.planSection}>
              <ThemedText type="meta" themeColor="textTertiary" style={styles.sectionLabel}>
                {t('proChoosePlan')}
              </ThemedText>
              <View style={styles.plans} accessibilityRole="radiogroup">
                {(['yearly', 'monthly'] as ProPlan[]).map((p) => {
                  const selected = plan === p;
                  const unavailable =
                    billingAvailable && priceStatus === 'ready' && !storePrices?.[p];
                  return (
                    <Pressable
                      key={p}
                      accessibilityRole="radio"
                      accessibilityState={{
                        checked: selected,
                        disabled: unavailable,
                      }}
                      disabled={unavailable}
                      onPress={() => {
                        setNotice(null);
                        setPlan(p);
                      }}
                      style={({ pressed }) => [
                        styles.planRow,
                        {
                          backgroundColor: selected ? theme.primarySoft : 'transparent',
                          borderColor: selected ? theme.primaryBorder : theme.cardBorder,
                          opacity: unavailable ? 0.45 : pressed ? 0.78 : 1,
                        },
                      ]}>
                      <View
                        style={[
                          styles.radio,
                          { borderColor: selected ? theme.primary : theme.cardBorderStrong },
                        ]}>
                        {selected && (
                          <View style={[styles.radioDot, { backgroundColor: theme.primary }]} />
                        )}
                      </View>
                      <View style={styles.planCopy}>
                        <View style={styles.planHeading}>
                          <ThemedText type="smallBold">
                            {p === 'yearly' ? t('yearly') : t('monthly')}
                          </ThemedText>
                          {p === 'yearly' && savingPercent !== null && savingPercent > 0 && (
                            <View
                              style={[
                                styles.savingBadge,
                                { backgroundColor: theme.primary, borderColor: theme.primary },
                              ]}>
                              <ThemedText type="nano" style={{ color: theme.onPrimary }}>
                                {tf('proSavePercent', { percent: savingPercent })}
                              </ThemedText>
                            </View>
                          )}
                        </View>
                        <ThemedText type="meta" themeColor="textTertiary">
                          {p === 'yearly' ? t('perYear') : t('perMonth')}
                        </ThemedText>
                      </View>
                      <ThemedText
                        type="subtitle"
                        tabular
                        style={[styles.planPrice, { textAlign: alignEnd() }]}>
                        {displayPrice(p)}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
              {billingAvailable && priceStatus === 'failed' && (
                <Button
                  variant="ghost"
                  label={t('retryPrices')}
                  onPress={() => {
                    setNotice(null);
                    setPriceRequest((request) => request + 1);
                  }}
                />
              )}
            </Section>
          )}

          {(privacyPolicyUrl || termsOfUseUrl) && (
            <View style={styles.legalLinks}>
              {privacyPolicyUrl && (
                <Pressable
                  accessibilityRole="link"
                  hitSlop={8}
                  onPress={() => void openLegal(privacyPolicyUrl)}>
                  <ThemedText type="meta" style={{ color: theme.primary }}>
                    {t('privacyPolicy')}
                  </ThemedText>
                </Pressable>
              )}
              {termsOfUseUrl && (
                <Pressable
                  accessibilityRole="link"
                  hitSlop={8}
                  onPress={() => void openLegal(termsOfUseUrl)}>
                  <ThemedText type="meta" style={{ color: theme.primary }}>
                    {t('termsOfUse')}
                  </ThemedText>
                </Pressable>
              )}
            </View>
          )}
        </ScrollView>

        <View
          style={[
            styles.purchaseBar,
            { borderColor: theme.cardBorder, backgroundColor: theme.background },
          ]}>
          {notice && (
            <View
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              style={[
                styles.notice,
                { borderColor: theme.expenseSoftBorder, backgroundColor: theme.expenseSoftBg },
              ]}>
              <Icon name="alert" size={18} color={theme.expense} />
              <View style={styles.noticeCopy}>
                <ThemedText type="smallBold">{notice.title}</ThemedText>
                <ThemedText type="meta" themeColor="textSecondary">
                  {notice.body}
                </ThemedText>
              </View>
            </View>
          )}

          {completion && (
            <View
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              style={[
                styles.success,
                { borderColor: theme.primaryBorder, backgroundColor: theme.primarySoft },
              ]}>
              <View style={[styles.successIcon, { backgroundColor: theme.primary }]}>
                <Icon name="check" size={20} color={theme.onPrimary} />
              </View>
              <View style={styles.successCopy}>
                <ThemedText type="smallBold">
                  {t(
                    completion === 'purchase'
                      ? 'proPurchaseSuccessTitle'
                      : 'proRestoreSuccessTitle',
                  )}
                </ThemedText>
                <ThemedText type="meta" themeColor="textSecondary">
                  {t(
                    completion === 'purchase'
                      ? 'proPurchaseSuccessBody'
                      : 'proRestoreSuccessBody',
                  )}
                </ThemedText>
              </View>
            </View>
          )}

          {completion ? (
            <Button label={t('proContinue')} icon="check" onPress={() => router.back()} />
          ) : state.pro ? (
            <>
              {Platform.OS !== 'web' && (
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
              <View style={styles.purchaseSummary}>
                <View style={styles.purchaseSummaryCopy}>
                  <ThemedText type="micro" themeColor="textTertiary">
                    {plan === 'yearly' ? t('yearly') : t('monthly')}
                  </ThemedText>
                  <ThemedText type="subtitle" tabular>
                    {displayPrice(plan)}
                  </ThemedText>
                </View>
                <ThemedText
                  type="meta"
                  themeColor="textSecondary"
                  style={[styles.chargeTiming, { textAlign: alignEnd() }]}>
                  {selectedStorePrice
                    ? tf(
                        plan === 'yearly'
                          ? 'proChargeTimingYear'
                          : 'proChargeTimingMonth',
                        { price: selectedStorePrice },
                      )
                    : t('proStoreConfirmsPrice')}
                </ThemedText>
              </View>
              <Button
                label={
                  billingAction === 'buy'
                    ? t('purchaseInProgress')
                    : selectedStorePrice
                      ? tf('startPlanWithPrice', {
                          plan: plan === 'yearly' ? t('yearly') : t('monthly'),
                          price: selectedStorePrice,
                        })
                      : t('getPro')
                }
                onPress={buy}
                disabled={billingAction !== null || (billingAvailable && !storePrices?.[plan])}
              />
              <Button
                variant="ghost"
                label={t('restorePurchase')}
                disabled={billingAction !== null}
                onPress={restore}
              />
              <ThemedText type="nano" themeColor="textTertiary" style={styles.renewalTerms}>
                {t(
                  Platform.OS === 'ios'
                    ? 'subscriptionRenewalTermsIos'
                    : 'subscriptionRenewalTermsAndroid',
                )}
              </ThemedText>
            </>
          )}
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
  },
  safe: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  headerWrap: {
    paddingHorizontal: ScreenPadding,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: ScreenPadding,
    paddingBottom: Spacing.four,
    gap: Spacing.four,
  },
  hero: {
    alignItems: 'flex-start',
    gap: Spacing.two,
    paddingTop: Spacing.two,
  },
  heroMark: {
    width: 48,
    height: 48,
    borderRadius: Radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
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
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: Radius.full,
  },
  sectionLabel: {
    marginBottom: Spacing.two,
  },
  featureIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: {
    flex: 1,
    gap: Spacing.half,
  },
  freeNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sheet,
    padding: Spacing.three,
  },
  planSection: {
    gap: Spacing.two,
  },
  plans: {
    gap: Spacing.two,
  },
  legalLinks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
  planRow: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: Radius.sheet,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: {
    width: 12,
    height: 12,
    borderRadius: Radius.full,
  },
  planCopy: {
    flex: 1,
    gap: Spacing.one,
  },
  planHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  savingBadge: {
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  planPrice: {
    flexShrink: 0,
  },
  success: {
    minHeight: 88,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.sheet,
    padding: Spacing.three,
  },
  successIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successCopy: {
    flex: 1,
    gap: Spacing.one,
  },
  purchaseBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: ScreenPadding,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
    gap: Spacing.two,
  },
  purchaseSummary: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
  },
  purchaseSummaryCopy: {
    minWidth: 104,
    gap: Spacing.one,
  },
  chargeTiming: {
    flex: 1,
  },
  renewalTerms: {
    textAlign: 'center',
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sheet,
    padding: Spacing.two,
    gap: Spacing.two,
  },
  noticeCopy: {
    flex: 1,
    gap: Spacing.one,
  },
});
