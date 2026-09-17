import { WorkflowHero } from '@/components/workflows/workflow-surfaces';
import { workflowCopy } from '@/components/workflows/workflow-copy';
import { useLanguage } from '@/hooks/use-language';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import { useWafraBilling } from '@/components/superwall-billing-context';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/controls';
import { Icon, type IconName } from '@/components/ui/icon';
import { Row, Section } from '@/components/ui/layout';
import { ScreenScaffold } from '@/components/ui/screen-scaffold';
import type { ScreenHeaderProps } from '@/components/ui/screen-header';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t, tf } from '@/lib/i18n';
import { autoCaptureMethod, trialDaysLeft } from '@/lib/purchases';
import { configuredPublicUrl } from '@/lib/public-links';
import { subscriptionManagementUrl } from '@/lib/billing';
import { useStore } from '@/lib/store';

type FeatureRow = {
  icon: IconName;
  titleKey: Parameters<typeof t>[0];
  textKey: Parameters<typeof t>[0];
};

type BillingAction = 'paywall' | 'restore' | 'manage' | null;

function features(): FeatureRow[] {
  return [
    {
      icon: 'spark',
      titleKey: 'featAutoTracking',
      textKey:
        autoCaptureMethod() === 'localAutomation' ? 'featAutoTrackingIosText' : 'featAutoTrackingText',
    },
    { icon: 'chart', titleKey: 'featInsights', textKey: 'featInsightsText' },
  ];
}

/**
 * Superwall owns the canonical remote purchase UI. This native screen remains a
 * resilient, localized shell for active status, restore/manage, legal links and
 * the case where a remote campaign is missing or cannot load.
 */
export default function ProScreen() {
  const words = workflowCopy(useLanguage());
  const theme = useTheme();
  const router = useRouter();
  const { state } = useStore();
  const billing = useWafraBilling();
  const [billingAction, setBillingAction] = useState<BillingAction>(null);
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null);
  const openedAutomatically = useRef(false);
  const trial = trialDaysLeft(state);
  const entitled = state.pro || state.founderPro;
  const privacyPolicyUrl = configuredPublicUrl('privacyPolicyUrl');
  const termsOfUseUrl = configuredPublicUrl('termsOfUseUrl');
  const legalReady = privacyPolicyUrl !== null && termsOfUseUrl !== null;
  const proHeader: ScreenHeaderProps = {
    title: t('wafraPro'),
    back: { label: t('back'), onPress: () => router.back() },
  };

  const openPaywall = useCallback(async (source: string) => {
    setNotice(null);
    if (!legalReady) {
      setNotice({ title: t('purchaseUnavailable'), body: t('purchaseLegalMissingBody') });
      return;
    }
    if (!billing.available || !billing.configured) {
      setNotice({
        title: t('purchaseUnavailable'),
        body: billing.configurationError ? t('purchaseFailedBody') : t('playOnlyBody'),
      });
      return;
    }
    setBillingAction('paywall');
    try {
      await billing.presentProPaywall({ source });
    } catch {
      setNotice({ title: t('purchaseUnavailable'), body: t('purchaseFailedBody') });
    } finally {
      setBillingAction(null);
    }
  }, [billing, legalReady]);

  useEffect(() => {
    if (
      entitled ||
      openedAutomatically.current ||
      !legalReady ||
      !billing.available ||
      !billing.configured
    ) return;
    openedAutomatically.current = true;
    void openPaywall('pro_screen_open');
  }, [billing.available, billing.configured, entitled, legalReady, openPaywall]);

  // A dashboard campaign can be absent/skipped even while the SDK itself is
  // configured. Never leave /pro looking like a tap that did nothing.
  useEffect(() => {
    if (!openedAutomatically.current || entitled) return;
    if (billing.paywallStatus === 'error' || billing.paywallStatus === 'skipped') {
      setNotice({ title: t('purchaseUnavailable'), body: t('purchaseFailedBody') });
    }
  }, [billing.paywallStatus, entitled]);

  const restore = async () => {
    setNotice(null);
    if (!billing.available || !billing.configured) {
      setNotice({ title: t('restoreFailed'), body: t('restoreFailedBody') });
      return;
    }
    setBillingAction('restore');
    const restored = await billing.restorePro();
    setBillingAction(null);
    if (restored === null) {
      setNotice({ title: t('restoreFailed'), body: t('restoreFailedBody') });
    } else if (!restored) {
      setNotice({ title: t('noPurchaseFound'), body: t('noPurchaseFoundBody') });
    } else {
      setNotice({ title: t('proRestoreSuccessTitle'), body: t('proRestoreSuccessBody') });
    }
  };

  const manage = async () => {
    setNotice(null);
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
        <View style={styles.featureText}>
          <ThemedText type="small">{title}</ThemedText>
          <ThemedText type="meta" themeColor="textTertiary">
            {t('publicLinkUnavailable')}
          </ThemedText>
        </View>
        <Icon name="alert" size={15} color={theme.warning} />
      </Row>
    );
  };

  return (
    <ScreenScaffold
      headerMode="native"
      header={proHeader}
      contentStyle={styles.content}
      scrollProps={{ showsVerticalScrollIndicator: false }}>
      <Section index={0} style={styles.hero}>
        <WorkflowHero title={t('wafraPro')} body={words.proBody} icon="diamond" />
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
        style={[styles.featuresCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
        <ThemedText type="meta" themeColor="textTertiary" style={styles.sectionLabel}>
          {t('proBenefitsTitle')}
        </ThemedText>
        {features().map((feature, index, rows) => (
          <Row key={feature.titleKey} last={index === rows.length - 1}>
            <View style={[styles.featureIcon, { backgroundColor: theme.backgroundSelected }]}>
              <Icon name={feature.icon} size={18} color={theme.textSecondary} />
            </View>
            <View style={styles.featureText}>
              <ThemedText type="small">{t(feature.titleKey)}</ThemedText>
              <ThemedText type="meta" themeColor="textTertiary">{t(feature.textKey)}</ThemedText>
            </View>
          </Row>
        ))}
      </Section>

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
            <ThemedText type="meta" themeColor="textTertiary">{t('featPasteFreeText')}</ThemedText>
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
              label={billingAction === 'paywall' ? t('purchaseInProgress') : t('getPro')}
              disabled={billingAction !== null}
              onPress={() => void openPaywall('pro_screen_cta')}
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
  featuresCard: { padding: Spacing.four, borderRadius: 20, borderWidth: 1 },
  sectionLabel: { marginBottom: Spacing.two },
  featureIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: { flex: 1, gap: 3 },
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
