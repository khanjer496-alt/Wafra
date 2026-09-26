/**
 * Pro, in context: the sheet that opens over Settings when someone without
 * Pro taps a gated control (automatic capture, bank-app notifications).
 *
 * It names the feature that was tapped, says in the app's existing words what
 * that feature does and what stays free, and offers the plans the store
 * returned — through `useProCheckout`, the same checkout the Pro screen runs,
 * with Restore beside Buy. Nothing here is a second purchase path, a guessed
 * price or a benefit Pro does not gate.
 *
 * Each opening is its own session: the checkout mounts when the sheet opens
 * (so Settings never asks the store for prices just by being shown) and stays
 * mounted through the close animation. While a purchase or restore is in
 * flight the sheet cannot be dismissed or left, so the store's answer is
 * always shown and no second checkout can start beside it.
 */
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
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
  // A new session on every opening; the last one stays shown (with its
  // feature) while the sheet slides away. Adjusted during render, React's
  // pattern for state that follows a prop.
  const [previous, setPrevious] = useState<ProGatedFeature | null>(null);
  const [session, setSession] = useState<{ feature: ProGatedFeature; id: number } | null>(null);
  if (feature !== previous) {
    setPrevious(feature);
    if (feature) setSession({ feature, id: (session?.id ?? 0) + 1 });
  }
  if (!session) return null;
  return <ProSheetSession key={session.id} feature={session.feature} visible={feature !== null} onClose={onClose} />;
}

function ProSheetSession({ feature, visible, onClose }: {
  feature: ProGatedFeature;
  visible: boolean;
  onClose: () => void;
}) {
  const band = useBand('settings');
  const router = useRouter();
  const language = useLanguage();
  const largeText = useLargeTextLayout();
  const words = settingsECopy(language);
  const copy = proCopy(language);
  const checkout = useProCheckout();
  const {
    billingAction, selectedPlan, selectedOffer, notice, entitled,
    privacyPolicyUrl, termsOfUseUrl, buySelectedPlan, restore, openLegal,
  } = checkout;
  const busy = billingAction !== null;

  const legal = [
    { key: 'privacy', label: t('privacyPolicy'), url: privacyPolicyUrl },
    { key: 'terms', label: t('termsOfUse'), url: termsOfUseUrl },
  ];

  const actions = (
    <View style={styles.actions} testID="pro-sheet-actions">
      {entitled ? (
        <EButton palette={band} label={t('proContinue')} onPress={onClose} testID="pro-sheet-done" />
      ) : (
        <>
          <EButton
            palette={band}
            testID="pro-sheet-buy"
            label={billingAction === 'purchase'
              ? t('purchaseInProgress')
              : selectedOffer
                ? tf('startPlanWithPrice', {
                    plan: selectedPlan === 'yearly' ? t('yearly') : t('monthly'),
                    price: selectedOffer.priceString,
                  })
                : t('getPro')}
            disabled={busy}
            busy={billingAction === 'purchase'}
            onPress={() => void buySelectedPlan()}
          />
          <EButton palette={band} variant="quiet" label={t('restorePurchase')} disabled={busy}
            busy={billingAction === 'restore'} onPress={() => void restore()} testID="pro-sheet-restore" />
          <EButton palette={band} variant="quiet" label={words.proSheetNotNow} disabled={busy}
            onPress={onClose} testID="pro-sheet-not-now" />
        </>
      )}
    </View>
  );

  const body = (
    <View style={styles.body} testID={`pro-sheet-${feature}`}>
      <ThemedText type="default" style={{ color: band.textSecondary }}>
        {proSheetFeatureText(feature, language)}
      </ThemedText>
      <ThemedText type="meta" style={{ color: band.textSecondary }}>{copy.freeText}</ThemedText>

      {entitled ? (
        <ThemedText type="smallBold" style={{ color: band.text }}>{t('proActiveThanks')}</ThemedText>
      ) : (
        <ProPlanOptions checkout={checkout} palette={band} testIDPrefix="pro-sheet-plan" />
      )}

      {notice && (
        <View
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={[styles.notice, { borderColor: band.rule, backgroundColor: band.card }]}>
          <ThemedText type="smallBold" style={{ color: band.text }}>{notice.title}</ThemedText>
          <ThemedText type="meta" style={{ color: band.textSecondary }}>{notice.body}</ThemedText>
        </View>
      )}

      <View style={[styles.links, largeText && styles.linksStacked]}>
        <Pressable accessibilityRole="button" testID="pro-sheet-more" hitSlop={4} disabled={busy}
          accessibilityState={{ disabled: busy }}
          onPress={() => { onClose(); router.push('/pro'); }} style={[styles.link, busy && styles.disabled]}>
          <ThemedText type="smallBold" style={{ color: band.tint }}>{words.proSheetMore}</ThemedText>
        </Pressable>
        {legal.map((link) => link.url ? (
          <Pressable key={link.key} accessibilityRole="link" accessibilityLabel={link.label} hitSlop={4}
            onPress={() => void openLegal(link.url!)} style={styles.link}>
            <ThemedText type="small" style={{ color: band.textSecondary }}>{link.label}</ThemedText>
          </Pressable>
        ) : null)}
      </View>
    </View>
  );

  return <ProSheetFrame palette={band} title={words.proSheetTitle[feature]} visible={visible}
    busy={busy} onClose={onClose} footer={actions}>{body}</ProSheetFrame>;
}

/**
 * The sheet itself. While a purchase or restore runs it is not dismissible:
 * no backdrop tap, drag, close button or Android back, so the answer lands
 * on a sheet that is still open.
 */
function ProSheetFrame({ palette, title, visible, busy, onClose, footer, children }: {
  palette: BandPalette;
  title: string;
  visible: boolean;
  busy: boolean;
  onClose: () => void;
  footer: React.ReactElement;
  children: React.ReactNode;
}) {
  const shared = { visible, onClose, title, palette, testID: 'pro-sheet' } as const;
  return busy
    ? <BottomSheet {...shared} dismissible={false} footer={footer}>{children}</BottomSheet>
    : <BottomSheet {...shared} footer={footer}>{children}</BottomSheet>;
}

const styles = StyleSheet.create({
  body: { gap: 14, paddingBottom: 8 },
  notice: { gap: 4, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 16 },
  actions: { gap: 4 },
  links: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 18, alignItems: 'center' },
  linksStacked: { flexDirection: 'column', alignItems: 'flex-start' },
  link: { minHeight: 44, justifyContent: 'center' },
  disabled: { opacity: 0.45 },
});
