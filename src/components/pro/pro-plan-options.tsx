/**
 * The plan choice, shared by the Pro screen and the in-context Pro sheet.
 *
 * Radio rows in design language E: a card per plan on the sheet, the chosen
 * one ringed in the band's own tint. Every price is the display string the
 * device's store returned (`offer.priceString`); nothing here computes,
 * converts or compares prices, so there is no percentage-off badge. A plan the
 * store did not return is drawn as unavailable rather than dropped, and the
 * renewal terms for the store in use sit under the choice.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import type { ProPlanOffer } from '@/components/superwall-billing-context';
import { Icon } from '@/components/ui/icon';
import type { BandPalette } from '@/constants/theme';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { PLAN_ORDER, type ProCheckout } from '@/hooks/use-pro-checkout';
import { t, tf } from '@/lib/i18n';
import type { ProPlan } from '@/lib/purchases';

export function ProPlanOptions({ checkout, palette, testIDPrefix = 'pro-plan' }: {
  checkout: ProCheckout;
  palette: BandPalette;
  /** `pro-plan` on the Pro screen; the sheet uses its own prefix. */
  testIDPrefix?: string;
}) {
  const largeText = useLargeTextLayout();
  const { offers, offerState, selectedPlan, setSelectedPlan, selectedOffer, missingPlans, store, checkoutReady, loadOffers } = checkout;

  const planRow = (offer: ProPlanOffer) => {
    const selected = offer.plan === selectedPlan;
    const label = offer.plan === 'yearly' ? t('yearly') : t('monthly');
    const period = offer.plan === 'yearly' ? t('perYear') : t('perMonth');
    return (
      <Pressable
        key={offer.productId}
        accessibilityRole="radio"
        accessibilityState={{ selected, checked: selected }}
        accessibilityLabel={`${label} · ${offer.priceString} ${period}`}
        testID={`${testIDPrefix}-${offer.plan}`}
        onPress={() => setSelectedPlan(offer.plan)}
        style={({ pressed }) => [
          styles.planRow,
          largeText && styles.planRowWrap,
          {
            borderColor: selected ? palette.tint : palette.rule,
            borderWidth: selected ? 2 : 1.5,
            backgroundColor: palette.card,
            opacity: pressed ? 0.85 : 1,
          },
        ]}>
        <View style={[styles.planMark, { borderColor: selected ? palette.tint : palette.textSecondary }]}>
          {selected && <View style={[styles.planDot, { backgroundColor: palette.tint }]} />}
        </View>
        <ThemedText type="smallBold" style={[styles.grow, { color: palette.text }]}>{label}</ThemedText>
        <View style={[styles.planPrice, largeText && styles.planPriceStacked]}>
          <ThemedText type="smallBold" tabular style={{ color: palette.text }}>{offer.priceString}</ThemedText>
          <ThemedText type="meta" style={{ color: palette.textSecondary }}>{period}</ThemedText>
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
      style={[styles.planRow, largeText && styles.planRowWrap, { borderColor: palette.rule, borderWidth: 1.5, backgroundColor: palette.card }]}>
      <View style={styles.grow}>
        <ThemedText type="smallBold" style={{ color: palette.text }}>{plan === 'yearly' ? t('yearly') : t('monthly')}</ThemedText>
        <ThemedText type="meta" style={{ color: palette.textSecondary }}>{t('priceUnavailable')}</ThemedText>
      </View>
      <Icon name="alert" size={16} color={palette.statusNear} />
    </View>
  );

  const retryPrices = (
    <Pressable accessibilityRole="button" onPress={() => void loadOffers()} hitSlop={8} style={styles.retry}>
      <ThemedText type="smallBold" style={{ color: palette.tint }}>{t('retryPrices')}</ThemedText>
    </Pressable>
  );

  if (offerState === 'loading') {
    return <ThemedText type="small" accessibilityLiveRegion="polite" style={{ color: palette.textSecondary }}>
      {t('priceLoading')}
    </ThemedText>;
  }

  if (offerState !== 'ready') {
    return (
      <View style={[styles.unavailable, largeText && styles.planRowWrap, { borderColor: palette.rule, backgroundColor: palette.card }]}>
        <Icon name="alert" size={18} color={palette.statusNear} />
        <View style={styles.grow}>
          <ThemedText type="smallBold" style={{ color: palette.text }}>
            {checkoutReady ? t('priceUnavailable') : t('playOnlyTitle')}
          </ThemedText>
          <ThemedText type="meta" style={{ color: palette.textSecondary }}>
            {checkoutReady ? t('priceUnavailableBody') : t('playOnlyBody')}
          </ThemedText>
          {checkoutReady && retryPrices}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.options}>
      <View accessibilityRole="radiogroup" style={styles.options}>
        {PLAN_ORDER.map((plan) => {
          const offer = offers.find((candidate) => candidate.plan === plan);
          return offer ? planRow(offer) : unavailablePlanRow(plan);
        })}
      </View>
      {missingPlans.length > 0 && (
        <View style={styles.grow}>
          <ThemedText type="meta" style={{ color: palette.textSecondary }}>
            {t('priceUnavailableBody')}
          </ThemedText>
          {retryPrices}
        </View>
      )}
      {selectedOffer && (
        <ThemedText type="meta" style={{ color: palette.textSecondary }}>
          {tf(
            selectedPlan === 'yearly' ? 'proChargeTimingYear' : 'proChargeTimingMonth',
            { price: selectedOffer.priceString },
          )}
        </ThemedText>
      )}
      <ThemedText type="meta" style={{ color: palette.textSecondary }}>
        {store === 'appStore'
          ? t('subscriptionRenewalTermsIos')
          : store === 'play'
            ? t('subscriptionRenewalTermsAndroid')
            : t('proStoreConfirmsPrice')}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  options: { gap: 10 },
  grow: { flex: 1, minWidth: 0, gap: 3 },
  planRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  // The price drops under the plan name at the accessibility sizes.
  planRowWrap: { flexWrap: 'wrap' },
  planMark: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planDot: { width: 10, height: 10, borderRadius: 5 },
  planPrice: { alignItems: 'flex-end', gap: 2 },
  planPriceStacked: { flexBasis: '100%', alignItems: 'flex-start', paddingStart: 22 + 12 },
  unavailable: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  retry: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
});
