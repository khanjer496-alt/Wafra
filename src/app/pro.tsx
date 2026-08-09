import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/controls';
import { Icon, type IconName } from '@/components/ui/icon';
import { Row, ScreenHeader, Section } from '@/components/ui/layout';
import { MaxContentWidth, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t, tf } from '@/lib/i18n';
import {
  autoCaptureMethod,
  PRO_REFERENCE_PRICE_STRINGS,
  TRIAL_DAYS,
  trialDaysLeft,
  yearlySavingMonths,
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
    { icon: 'chart', titleKey: 'featInsights', textKey: 'featInsightsText' },
    { icon: 'calendar', titleKey: 'featSalaryMonths', textKey: 'featSalaryMonthsText' },
    { icon: 'download', titleKey: 'featBackup', textKey: 'featBackupText' },
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
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null);
  const trial = trialDaysLeft(state);
  const rows = features();

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

  const savingMonths = useMemo(() => {
    if (!storePrices) return Platform.OS === 'web' ? yearlySavingMonths() : null;
    const monthly = storePrices.monthly;
    const yearly = storePrices.yearly;
    if (!monthly || !yearly || monthly.currencyCode !== yearly.currencyCode) return null;
    const months = yearlySavingMonths({
      monthly: { fils: Math.round(monthly.price * 100) },
      yearly: { fils: Math.round(yearly.price * 100) },
    });
    return months > 0 ? months : null;
  }, [storePrices]);

  /**
   * What the last tap on Get Pro or Restore had to say.
   *
   * Every one of these answers was an `Alert.alert`, and `isBillingAvailable()`
   * is false on the web export — where `Alert.alert` is an empty method. So on
   * the one build the end-to-end suite drives, the two buttons on the screen
   * that sells the product did nothing, said nothing and logged nothing.
   *
   * It is drawn under the buttons rather than over them: none of these five
   * outcomes asks the user to decide anything, so none of them has earned a
   * modal. What they have to do is be visible, which an alert was not.
   */
  const buy = async () => {
    setNotice(null);
    if (!billingAvailable) {
      setNotice({ title: t('playOnlyTitle'), body: t('playOnlyBody') });
      return;
    }
    if (!storePrices?.[plan]) {
      setNotice({ title: t('priceUnavailable'), body: t('priceUnavailableBody') });
      return;
    }
    const outcome = await purchasePro(plan);
    if (outcome === 'granted') setPro(true);
    // 'cancelled' is the user closing the sheet, and gets no dialogue —
    // telling someone their own decision failed is noise. 'failed' is the
    // store: an unactivated SKU, an SDK that would not configure, a throw.
    // Without this branch the button was simply inert forever, which reads as
    // a broken app rather than a broken listing.
    else if (outcome === 'failed')
      setNotice({ title: t('purchaseFailed'), body: t('purchaseFailedBody') });
  };

  const restore = async () => {
    setNotice(null);
    if (!isBillingAvailable()) {
      setNotice({ title: t('nothingToRestore'), body: t('nothingToRestoreBody') });
      return;
    }
    const restored = await restorePro();
    if (restored) setPro(true);
    // null is "could not ask the store", NOT "never paid". A subscriber
    // reinstalling on a bad connection must not be told their purchase does
    // not exist — they should be told to try again.
    else if (restored === null)
      setNotice({ title: t('restoreFailed'), body: t('restoreFailedBody') });
    else setNotice({ title: t('noPurchaseFound'), body: t('noPurchaseFoundBody') });
  };

  const manage = async () => {
    setNotice(null);
    const url = await subscriptionManagementUrl();
    if (!url) {
      setNotice({ title: t('manageSubscriptionFailed'), body: t('manageSubscriptionFailedBody') });
      return;
    }
    try {
      await Linking.openURL(url);
    } catch {
      setNotice({ title: t('manageSubscriptionFailed'), body: t('manageSubscriptionFailedBody') });
    }
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.headerWrap}>
          <ScreenHeader title={t('wafraPro')} onBack={() => router.back()} />
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Section index={0} style={styles.hero}>
            <Icon name="diamond" size={30} color={theme.warning} />
            <ThemedText type="title">{t('wafraPro')}</ThemedText>
            <ThemedText type="default" themeColor="textSecondary">
              {state.pro
                ? t('proActiveThanks')
                : trial > 0
                  ? tf('trialDaysLeftPaywall', {
                      total: TRIAL_DAYS,
                      left: trial,
                      s: trial === 1 ? '' : 's',
                    })
                  : t('trialEndedPaywall')}
            </ThemedText>
            {!state.pro && trial > 0 && (
              <ThemedText type="nano" style={{ color: theme.primary }}>
                {t('freeTrialActive')}
              </ThemedText>
            )}
          </Section>

          <Section index={1}>
            {rows.map((f, i) => (
              <Row key={f.titleKey} last={i === rows.length - 1}>
                <View style={styles.featureIcon}>
                  <Icon name={f.icon} size={19} color={theme.textSecondary} />
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
            <Section index={3} style={styles.buy}>
              <View style={styles.plans}>
                {(['yearly', 'monthly'] as ProPlan[]).map((p) => {
                  const selected = plan === p;
                  return (
                    <Pressable
                      key={p}
                      accessibilityRole="button"
                      accessibilityState={{
                        selected,
                        disabled: billingAvailable && priceStatus === 'ready' && !storePrices?.[p],
                      }}
                      disabled={billingAvailable && priceStatus === 'ready' && !storePrices?.[p]}
                      onPress={() => setPlan(p)}
                      style={[
                        styles.plan,
                        {
                          backgroundColor: selected ? theme.primarySoft : 'transparent',
                          borderColor: selected ? theme.primaryBorder : theme.cardBorder,
                        },
                      ]}>
                      <ThemedText type="micro" themeColor="textTertiary">
                        {p === 'yearly' ? t('yearly') : t('monthly')}
                      </ThemedText>
                      <ThemedText type="subtitle" tabular>
                        {storePrices?.[p]?.priceString ??
                          (Platform.OS === 'web'
                            ? PRO_REFERENCE_PRICE_STRINGS[p]
                            : t(priceStatus === 'loading' ? 'priceLoading' : 'priceUnavailable'))}
                      </ThemedText>
                      <ThemedText type="meta" themeColor="textTertiary">
                        {p === 'yearly'
                          ? savingMonths
                            ? `${t('perYear')} ${tf('monthsFreeSuffix', { months: savingMonths })}`
                            : t('perYear')
                          : t('perMonth')}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
              <Button
                label={t('getPro')}
                onPress={buy}
                disabled={billingAvailable && !storePrices?.[plan]}
              />
              {billingAvailable && priceStatus === 'failed' && (
                <Button
                  variant="ghost"
                  label={t('retryPrices')}
                  onPress={() => setPriceRequest((request) => request + 1)}
                />
              )}
              <Button variant="ghost" label={t('restorePurchase')} onPress={restore} />
              {billingAvailable && (
                <Button variant="ghost" label={t('manageSubscription')} onPress={manage} />
              )}
              <ThemedText type="nano" themeColor="textTertiary">
                {t('subscriptionRenewalTerms')}
              </ThemedText>
            </Section>
          )}
          {state.pro && billingAvailable && (
            <Section index={3} style={styles.buy}>
              <Button variant="ghost" label={t('manageSubscription')} onPress={manage} />
            </Section>
          )}
          {notice && (
            <View
              accessibilityLiveRegion="polite"
              style={[
                styles.notice,
                { borderColor: theme.cardBorder, backgroundColor: theme.backgroundElement },
              ]}>
              <ThemedText type="small">{notice.title}</ThemedText>
              <ThemedText type="meta" themeColor="textTertiary">
                {notice.body}
              </ThemedText>
            </View>
          )}
        </ScrollView>
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
  content: {
    paddingHorizontal: ScreenPadding,
    paddingBottom: Spacing.six,
    gap: Spacing.four + 2,
  },
  hero: {
    alignItems: 'flex-start',
    gap: Spacing.two + 2,
    paddingTop: Spacing.two,
  },
  featureIcon: {
    width: 30,
    alignItems: 'center',
  },
  featureText: {
    flex: 1,
    gap: Spacing.half,
  },
  buy: {
    gap: Spacing.two + 2,
  },
  freeNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sheet,
    padding: Spacing.three,
  },
  plans: {
    flexDirection: 'row',
    gap: Spacing.two + 2,
  },
  notice: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sheet,
    padding: Spacing.three,
    gap: Spacing.half,
  },
  plan: {
    flex: 1,
    borderRadius: Radius.sheet,
    borderWidth: 1,
    padding: Spacing.three,
    gap: Spacing.two - 2,
    alignItems: 'flex-start',
  },
});
