import { workflowCopy } from '@/components/workflows/workflow-copy';
import { useLanguage } from '@/hooks/use-language';
import { useRouter } from 'expo-router';
import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ProPlanOptions } from '@/components/pro/pro-plan-options';
import { BandTitle } from '@/components/settings-band/band-title';
import { ThemedText } from '@/components/themed-text';
import { EButton } from '@/components/ui/band/e-button';
import { GlyphTile } from '@/components/ui/band/glyph-tile';
import { BandScaffold, type BandNav } from '@/components/ui/band-scaffold';
import { Icon, type IconName } from '@/components/ui/icon';
import { Row } from '@/components/ui/layout';
import { Spacing } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useProCheckout } from '@/hooks/use-pro-checkout';
import { t, tf } from '@/lib/i18n';
import { autoCaptureMethod } from '@/lib/purchases';
import { proCopy } from '@/lib/pro-copy';

type FeatureRow = {
  icon: IconName;
  title: string;
  text: string;
};

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
 * Design language E: the ink band carries the plain title, what Pro does in
 * one sentence and where the trial stands; the sheet holds what Pro gates,
 * the plan radios, what stays free and the store actions. The checkout itself
 * lives in `useProCheckout`, shared with the in-context Pro sheet over
 * Settings, so both surfaces charge through exactly one path. Every price on
 * it is the string the device's own store returned; a plan the store does not
 * return is shown as unavailable instead of being advertised at a guessed
 * figure.
 */
export default function ProScreen() {
  const language = useLanguage();
  const words = workflowCopy(language);
  const copy = proCopy(language);
  const band = useBand('home');
  // At the accessibility sizes each row's icon sits above its text, so a long
  // word ("subscriptions") has the full width instead of breaking beside it.
  const largeText = useLargeTextLayout();
  const router = useRouter();
  const checkout = useProCheckout();
  const {
    state, billingAction, selectedPlan, selectedOffer, notice, trial, entitled,
    privacyPolicyUrl, termsOfUseUrl, buySelectedPlan, restore, manage, openLegal,
  } = checkout;
  const proNav: BandNav = { back: true };

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
        <ThemedText type="smallBold" style={{ color: band.tint }}>
          {title}
        </ThemedText>
      </Pressable>
    );
    return (
      <Row last={last}>
        <View style={[styles.featureText, largeText && styles.featureTextStacked]}>
          <ThemedText type="small" style={{ color: band.text }}>{title}</ThemedText>
          <ThemedText type="meta" style={{ color: band.textSecondary }}>
            {t('publicLinkUnavailable')}
          </ThemedText>
        </View>
        <Icon name="alert" size={15} color={band.statusNear} />
      </Row>
    );
  };

  const status = entitled
    ? t('proActiveThanks')
    : trial > 0
      ? tf('proTrialActiveBody', { left: trial, s: trial === 1 ? '' : 's' })
      : t('proTrialEndedBody');

  return (
    <BandScaffold
      band="home"
      testID="pro-screen"
      nav={proNav}
      contentStyle={styles.content}
      scrollProps={{ showsVerticalScrollIndicator: false }}
      bandContent={(
        <View style={styles.bandBody} testID="pro-band">
          <BandTitle title={t('wafraPro')} body={t('proOutcomeTitle')} palette={band} />
          <ThemedText type="small" style={{ color: band.onBandSecondary }}>{status}</ThemedText>
        </View>
      )}>
      <View style={styles.section} testID="pro-benefits">
        <ThemedText type="heading" accessibilityRole="header" style={{ color: band.text }}>
          {t('proBenefitsTitle')}
        </ThemedText>
        {features(copy).map((feature, index, rows) => (
          <View key={feature.title}
            style={[styles.featureRow, largeText && styles.featureRowStacked,
              index < rows.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: band.rule }]}>
            <GlyphTile icon={feature.icon} palette={band} size={40} />
            <View style={[styles.featureText, largeText && styles.featureTextStacked]}>
              <ThemedText type="smallBold" style={{ color: band.text }}>{feature.title}</ThemedText>
              <ThemedText type="meta" style={{ color: band.textSecondary }}>{feature.text}</ThemedText>
            </View>
          </View>
        ))}
        <ThemedText type="meta" style={{ color: band.textSecondary }}>{words.proBody}</ThemedText>
      </View>

      {!entitled && (
        <View style={styles.section} testID="pro-plans">
          <ThemedText type="heading" accessibilityRole="header" style={{ color: band.text }}>
            {t('proChoosePlan')}
          </ThemedText>
          <ProPlanOptions checkout={checkout} palette={band} />
        </View>
      )}

      <View style={[styles.freeNote, largeText && styles.featureRowStacked, { borderColor: band.rule, backgroundColor: band.card }]}
        testID="pro-free">
        <GlyphTile icon="check" palette={band} size={40} />
        <View style={[styles.featureText, largeText && styles.featureTextStacked]}>
          <ThemedText type="smallBold" style={{ color: band.text }}>{copy.freeTitle}</ThemedText>
          <ThemedText type="meta" style={{ color: band.textSecondary }}>{copy.freeText}</ThemedText>
          <Pressable accessibilityRole="button" onPress={() => router.push('/import-sms')} hitSlop={8} style={styles.inlineAction}>
            <ThemedText type="smallBold" style={{ color: band.tint }}>{t('pasteBankMessage')}</ThemedText>
          </Pressable>
        </View>
      </View>

      {notice && (
        <View
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={[styles.notice, { borderColor: band.rule, backgroundColor: band.card }]}>
          <ThemedText type="smallBold" style={{ color: band.text }}>{notice.title}</ThemedText>
          <ThemedText type="meta" style={{ color: band.textSecondary }}>{notice.body}</ThemedText>
        </View>
      )}

      <View style={styles.actions}>
        {entitled ? (
          <>
            {!state.founderPro && Platform.OS !== 'web' && (
              <EButton
                palette={band}
                variant="secondary"
                label={t('manageSubscription')}
                disabled={billingAction !== null}
                onPress={manage}
              />
            )}
            <EButton palette={band} variant="quiet" label={t('proContinue')} onPress={() => router.back()} />
          </>
        ) : (
          <>
            <EButton
              palette={band}
              testID="pro-buy"
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
            <EButton
              palette={band}
              variant="quiet"
              label={t('restorePurchase')}
              disabled={billingAction !== null}
              onPress={() => void restore()}
            />
          </>
        )}
      </View>

      <View style={[styles.legalLinks, { borderColor: band.rule }]}>
        {publicLinkRow(t('privacyPolicy'), privacyPolicyUrl)}
        {publicLinkRow(t('termsOfUse'), termsOfUseUrl, true)}
      </View>
    </BandScaffold>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.four },
  bandBody: { gap: 12, paddingBottom: Spacing.two },
  section: { gap: Spacing.two },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingVertical: 12 },
  featureRowStacked: { flexWrap: 'wrap' },
  featureText: { flex: 1, minWidth: 0, gap: 3 },
  featureTextStacked: { flexBasis: '100%' },
  freeNote: {
    flexDirection: 'row',
    gap: 14,
    padding: 16,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  inlineAction: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  notice: {
    gap: Spacing.one,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: Spacing.three,
  },
  actions: { gap: Spacing.two },
  legalLinks: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
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
