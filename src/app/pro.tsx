import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/controls';
import { Icon, type IconName } from '@/components/ui/icon';
import { Row, ScreenHeader, Section } from '@/components/ui/layout';
import { Money } from '@/components/ui/money';
import { MaxContentWidth, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t, tf } from '@/lib/i18n';
import {
  autoCaptureMethod,
  PRO_PRICES,
  TRIAL_DAYS,
  trialDaysLeft,
  yearlySavingMonths,
  type ProPlan,
} from '@/lib/purchases';
import { isBillingAvailable, purchasePro, restorePro } from '@/lib/billing';
import { useStore } from '@/lib/store';

type FeatureRow = {
  icon: IconName;
  titleKey: Parameters<typeof t>[0];
  textKey: Parameters<typeof t>[0];
};

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
 * store build — Play Billing on Android, StoreKit on iPhone; side-load builds
 * explain that and stay functional via the founder unlock in Settings.
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
  const trial = trialDaysLeft(state);
  const rows = features();

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
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null);

  const buy = async () => {
    setNotice(null);
    if (!isBillingAvailable()) {
      // Store-name copy stays in i18n rather than being assembled from
      // billingStore(): contracts.test.js fails any English sentence written
      // into a screen, and a template literal is still an English sentence.
      // These keys read "Play Store", which is correct for this Android
      // milestone; the App Store wording needs its own keys before iOS ships.
      setNotice({ title: t('playOnlyTitle'), body: t('playOnlyBody') });
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

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.headerWrap}>
          <ScreenHeader title={t('wafraPro')} onBack={() => router.back()} />
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Section index={0} style={styles.hero}>
            {/* No founder unlock here. There was one — a single long-press on
                this icon toggled Pro — which put a free unlock on the most
                discoverable surface in the app, the screen that sells it.
                Long-pressing something is an ordinary thing to try. The
                deliberate unlock is seven taps on the version row in
                Settings, which nobody reaches by accident. */}
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
                      accessibilityState={{ selected }}
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
                      <Money fils={PRO_PRICES[p].fils} type="subtitle" decimals />
                      <ThemedText type="meta" themeColor="textTertiary">
                        {p === 'yearly'
                          ? `${t('perYear')} ${tf('monthsFreeSuffix', { months: yearlySavingMonths() })}`
                          : t('perMonth')}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
              <Button label={t('getPro')} onPress={buy} />
              <Button variant="ghost" label={t('restorePurchase')} onPress={restore} />
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
            </Section>
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
