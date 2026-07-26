import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/controls';
import { Icon, type IconName } from '@/components/ui/icon';
import { Row, ScreenHeader, Section } from '@/components/ui/layout';
import { Money } from '@/components/ui/money';
import { MaxContentWidth, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/lib/i18n';
import {
  isBillingAvailable,
  PRO_PRICES,
  purchasePro,
  restorePro,
  TRIAL_DAYS,
  trialDaysLeft,
  type ProPlan,
} from '@/lib/purchases';
import { useStore } from '@/lib/store';

const FEATURES: { icon: IconName; titleKey: Parameters<typeof t>[0]; textKey: Parameters<typeof t>[0] }[] = [
  { icon: 'spark', titleKey: 'featAutoTracking', textKey: 'featAutoTrackingText' },
  { icon: 'chart', titleKey: 'featInsights', textKey: 'featInsightsText' },
  { icon: 'calendar', titleKey: 'featSalaryMonths', textKey: 'featSalaryMonthsText' },
  { icon: 'download', titleKey: 'featBackup', textKey: 'featBackupText' },
];

/**
 * Wafra Pro paywall. Purchases run through Google Play Billing on the Play
 * build; side-load builds explain that and stay functional via the founder
 * unlock in Settings.
 */
export default function ProScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { state, setPro } = useStore();
  const [plan, setPlan] = useState<ProPlan>('yearly');
  const trial = trialDaysLeft(state);

  const buy = async () => {
    if (!isBillingAvailable()) {
      Alert.alert(
        'Available with the Play Store release',
        'Purchases go through Google Play billing, which only works when Wafra is installed ' +
          'from the Play Store. This build has every Pro feature unlockable from Settings.',
      );
      return;
    }
    if (await purchasePro(plan)) setPro(true);
  };

  const restore = async () => {
    if (!isBillingAvailable()) {
      Alert.alert('Nothing to restore', 'Purchases arrive with the Play Store release.');
      return;
    }
    if (await restorePro()) setPro(true);
    else Alert.alert('No purchase found', 'No previous Wafra Pro purchase on this Google account.');
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.headerWrap}>
          <ScreenHeader title="Wafra Pro" onBack={() => router.back()} />
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Section index={0} style={styles.hero}>
            {/* Founder unlock: long-press the mark (side-load builds). */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Wafra Pro"
              delayLongPress={700}
              onLongPress={() => {
                const next = !state.pro;
                setPro(next);
                Alert.alert(
                  next ? 'Founder mode' : 'Founder mode off',
                  next ? 'Wafra Pro unlocked on this device.' : 'Wafra Pro disabled on this device.',
                );
              }}>
              <Icon name="diamond" size={30} color={theme.warning} />
            </Pressable>
            <ThemedText type="title">Wafra Pro</ThemedText>
            <ThemedText type="default" themeColor="textSecondary">
              {state.pro
                ? t('proActiveThanks')
                : trial > 0
                  ? `Everything is free for your first ${TRIAL_DAYS} days — ${trial} day${trial === 1 ? '' : 's'} left. Keep it going:`
                  : t('trialEndedPaywall')}
            </ThemedText>
            {!state.pro && trial > 0 && (
              <ThemedText type="nano" style={{ color: theme.primary }}>
                {t('freeTrialActive')}
              </ThemedText>
            )}
          </Section>

          <Section index={1}>
            {FEATURES.map((f, i) => (
              <Row key={f.titleKey} last={i === FEATURES.length - 1}>
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

          {!state.pro && (
            <Section index={2} style={styles.buy}>
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
                        {p === 'yearly' ? t('perYear') : t('perMonth')}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
              <Button label={t('getPro')} onPress={buy} />
              <Button variant="ghost" label={t('restorePurchase')} onPress={restore} />
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
  plans: {
    flexDirection: 'row',
    gap: Spacing.two + 2,
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
