/**
 * Pro, in context: the sheet that opens over Settings when someone without
 * Pro taps a gated control (automatic capture, bank-app notifications).
 *
 * It names the feature that was tapped, says in the app's existing words what
 * that feature does and what stays free, and offers the plans the store
 * returned — through `useProCheckout`, the same checkout the Pro screen runs.
 * Nothing here is a second purchase path, a guessed price or a benefit Pro
 * does not gate. Restore and subscription management stay one tap away on the
 * full Pro screen ("All Pro details").
 *
 * The checkout mounts only once the sheet has been opened, so Settings never
 * asks the store for prices just by being shown.
 */
import { useRouter } from 'expo-router';
import React, { useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ProPlanOptions } from '@/components/pro/pro-plan-options';
import { ThemedText } from '@/components/themed-text';
import { EButton } from '@/components/ui/band/e-button';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import type { BandPalette } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useProCheckout } from '@/hooks/use-pro-checkout';
import { t, tf } from '@/lib/i18n';
import type { ProGatedFeature } from '@/lib/pro-gate';
import { proCopy } from '@/lib/pro-copy';
import { autoCaptureMethod } from '@/lib/purchases';
import { settingsECopy } from '@/lib/settings-e-copy';

/** What the tapped feature does, in the Pro screen's own words. */
export function proSheetFeatureText(feature: ProGatedFeature, language: string): string {
  if (feature === 'notifications') return proCopy(language).notificationsText;
  return t(autoCaptureMethod() === 'localAutomation' ? 'featAutoTrackingIosText' : 'featAutoTrackingText');
}

export function ProSheet({ feature, onClose }: {
  /** The gated feature that was tapped; null keeps the sheet closed. */
  feature: ProGatedFeature | null;
  onClose: () => void;
}) {
  const band = useBand('settings');
  const language = useLanguage();
  const words = settingsECopy(language);
  // The title stays on the feature that opened the sheet while it slides away.
  const shown = useRef<ProGatedFeature | null>(null);
  if (feature) shown.current = feature;
  const current = shown.current;
  if (!current) return null;
  return (
    <BottomSheet
      visible={feature !== null}
      onClose={onClose}
      title={words.proSheetTitle[current]}
      palette={band}
      testID="pro-sheet">
      <ProSheetBody feature={current} palette={band} onClose={onClose} />
    </BottomSheet>
  );
}

function ProSheetBody({ feature, palette, onClose }: {
  feature: ProGatedFeature;
  palette: BandPalette;
  onClose: () => void;
}) {
  const router = useRouter();
  const language = useLanguage();
  const largeText = useLargeTextLayout();
  const words = settingsECopy(language);
  const copy = proCopy(language);
  const checkout = useProCheckout();
  const {
    billingAction, selectedPlan, selectedOffer, notice, entitled,
    privacyPolicyUrl, termsOfUseUrl, buySelectedPlan, openLegal,
  } = checkout;

  const legal = [
    { key: 'privacy', label: t('privacyPolicy'), url: privacyPolicyUrl },
    { key: 'terms', label: t('termsOfUse'), url: termsOfUseUrl },
  ];

  return (
    <View style={styles.body} testID={`pro-sheet-${feature}`}>
      <ThemedText type="default" style={{ color: palette.textSecondary }}>
        {proSheetFeatureText(feature, language)}
      </ThemedText>
      <ThemedText type="meta" style={{ color: palette.textSecondary }}>{copy.freeText}</ThemedText>

      {entitled ? (
        <ThemedText type="smallBold" style={{ color: palette.text }}>{t('proActiveThanks')}</ThemedText>
      ) : (
        <ProPlanOptions checkout={checkout} palette={palette} testIDPrefix="pro-sheet-plan" />
      )}

      {notice && (
        <View
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={[styles.notice, { borderColor: palette.rule, backgroundColor: palette.card }]}>
          <ThemedText type="smallBold" style={{ color: palette.text }}>{notice.title}</ThemedText>
          <ThemedText type="meta" style={{ color: palette.textSecondary }}>{notice.body}</ThemedText>
        </View>
      )}

      <View style={styles.actions}>
        {entitled ? (
          <EButton palette={palette} label={t('proContinue')} onPress={onClose} testID="pro-sheet-done" />
        ) : (
          <EButton
            palette={palette}
            testID="pro-sheet-buy"
            label={billingAction === 'purchase'
              ? t('purchaseInProgress')
              : selectedOffer
                ? tf('startPlanWithPrice', {
                    plan: selectedPlan === 'yearly' ? t('yearly') : t('monthly'),
                    price: selectedOffer.priceString,
                  })
                : words.proSheetContinue}
            disabled={billingAction !== null}
            busy={billingAction === 'purchase'}
            onPress={() => void buySelectedPlan()}
          />
        )}
        {!entitled && (
          <EButton palette={palette} variant="quiet" label={words.proSheetNotNow} onPress={onClose} testID="pro-sheet-not-now" />
        )}
      </View>

      <View style={[styles.links, largeText && styles.linksStacked]}>
        <Pressable accessibilityRole="button" testID="pro-sheet-more" hitSlop={4}
          onPress={() => { onClose(); router.push('/pro'); }} style={styles.link}>
          <ThemedText type="smallBold" style={{ color: palette.tint }}>{words.proSheetMore}</ThemedText>
        </Pressable>
        {legal.map((link) => link.url ? (
          <Pressable key={link.key} accessibilityRole="link" accessibilityLabel={link.label} hitSlop={4}
            onPress={() => void openLegal(link.url!)} style={styles.link}>
            <ThemedText type="small" style={{ color: palette.textSecondary }}>{link.label}</ThemedText>
          </Pressable>
        ) : null)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: 14, paddingBottom: 8 },
  notice: { gap: 4, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 16 },
  actions: { gap: 8, marginTop: 4 },
  links: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 18, alignItems: 'center' },
  linksStacked: { flexDirection: 'column', alignItems: 'flex-start' },
  link: { minHeight: 44, justifyContent: 'center' },
});
