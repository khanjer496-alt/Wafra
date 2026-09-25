/**
 * The first-run "ready" summary: how much of the past the ledger now holds,
 * where the money went, and which payments repeat. Every figure comes from
 * onboarding-ready.ts; nothing here estimates. While imports are still being
 * read, it says the figures are not final rather than presenting them as a
 * finished picture.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GrowBar } from '@/components/ui/grow-bar';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { categoryLabel } from '@/lib/categories';
import { formatMoneyText, type LedgerMoneySpec } from '@/lib/ledger-money';
import { onboardingCopy } from '@/lib/onboarding-copy';
import type { ReadySummary as ReadySummaryData } from '@/lib/onboarding-ready';

/** Onboarding is night mode regardless of the OS theme (see onboarding-gate). */
const night = Colors.dark;

export function ReadySummary({ summary, money, language, pending }: {
  summary: ReadySummaryData;
  money: LedgerMoneySpec | null;
  language: 'en' | 'ar';
  pending: boolean;
}) {
  const copy = onboardingCopy(language);
  // The transaction count is the result card's; this line adds only what the
  // card does not say, so the two never show different numbers for one thing.
  const line = [
    summary.months > 0 ? copy.readyMonths(summary.months) : null,
    summary.merchants > 0 ? copy.readyMerchants(summary.merchants) : null,
  ].filter(Boolean).join(' · ');
  const bars = money
    ? [
        ...summary.categories.map((item) => ({
          key: item.category,
          label: categoryLabel(item.category, language),
          amount: item.amountMinor,
        })),
        ...(summary.otherMinor > 0 ? [{ key: 'rest', label: copy.otherCategory, amount: summary.otherMinor }] : []),
      ]
    : [];
  const largest = bars.reduce((max, bar) => Math.max(max, bar.amount), 0);
  return (
    <View style={styles.root} testID="onboarding-ready-summary">
      {line ? <ThemedText style={styles.line}>{line}</ThemedText> : null}
      {pending ? (
        <ThemedText style={styles.pending} accessibilityLiveRegion="polite" testID="onboarding-ready-pending">
          {copy.readyPending}
        </ThemedText>
      ) : null}
      {bars.length > 0 && money ? (
        <View style={styles.bars} testID="onboarding-ready-categories">
          <ThemedText style={styles.heading} accessibilityRole="header">{copy.whereItWent}</ThemedText>
          {bars.map((bar, index) => {
            const amount = formatMoneyText(bar.amount, money, { decimals: false });
            return (
              <View key={bar.key} style={styles.bar} accessible accessibilityLabel={`${bar.label}, ${amount}`}>
                <View style={styles.barHead}>
                  <ThemedText style={styles.barLabel} numberOfLines={1}>{bar.label}</ThemedText>
                  <ThemedText style={styles.barAmount}>{amount}</ThemedText>
                </View>
                <View style={styles.track}>
                  <GrowBar
                    axis="width"
                    size={largest > 0 ? Math.max(2, Math.round((bar.amount / largest) * 100)) : 0}
                    delay={index * 60}
                    style={styles.fill}
                  />
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
      {summary.subscriptions + summary.bills > 0 ? (
        <ThemedText style={styles.found} testID="onboarding-ready-recurring">
          {copy.foundRecurring(summary.subscriptions, summary.bills)}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%', gap: Spacing.three },
  line: { color: night.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  pending: { color: night.warning, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  heading: { color: night.text, fontFamily: Fonts.sansSemi, fontSize: 15 },
  bars: { gap: Spacing.two + 2 },
  bar: { gap: 6 },
  barHead: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  barLabel: { flex: 1, color: night.text, fontSize: 14 },
  barAmount: { color: night.text, fontFamily: Fonts.mono, fontSize: 14, fontVariant: ['tabular-nums'] },
  track: { height: 6, borderRadius: 3, backgroundColor: night.track, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: night.primary },
  found: { color: night.textSecondary, fontSize: 14, lineHeight: 20 },
});
