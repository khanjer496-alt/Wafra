import { homeSummaryCopy as copy } from '@/lib/reference-copy';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { WafraMark } from '@/components/wafra-logo';
import { Money } from '@/components/ui/money';
import type { Colors } from '@/constants/theme';
import { formatAmount } from '@/lib/format';
import { ledgerCurrencyCode } from '@/lib/markets';

type Props = {
  theme: typeof Colors.light;
  language: string;
  largeText: boolean;
  greeting: string;
  dateLabel: string;
  periodLabel: string;
  incomeFils: number;
  expenseFils: number;
  onPeriod: () => void;
  onAdd: () => void;
  onSettings: () => void;
  onIncome: () => void;
  onSpending: () => void;
};

/** One question on Home: what have I spent? Account balances belong in Accounts. */
export function ReferenceHomeSummary(p: Props) {
  const w = copy[p.language === 'ar' ? 'ar' : 'en'];
  return <View style={styles.root} testID="reference-home-summary">
    <View style={styles.header}>
      <View style={styles.wordmark}><WafraMark size={28} /><ThemedText type="title">Wafra</ThemedText></View>
      <Pressable accessibilityRole="button" accessibilityLabel={w.add} onPress={p.onAdd}
        style={({ pressed }) => [styles.headerAction, { opacity: pressed ? 0.65 : 1 }]}>
        <Icon name="plus" size={22} color={p.theme.primary} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={w.settings} onPress={p.onSettings}
        style={({ pressed }) => [styles.headerAction, { opacity: pressed ? 0.65 : 1 }]}>
        <Icon name="sliders" size={21} color={p.theme.text} />
      </Pressable>
    </View>

    <View style={styles.dateLine}>
      <ThemedText type="meta" themeColor="textSecondary">{p.greeting}</ThemedText>
      <ThemedText type="meta" themeColor="textTertiary">{p.dateLabel}</ThemedText>
    </View>
    <View style={styles.summary} testID="journal-summary">
      <View style={styles.summaryTop}>
        <ThemedText type="small" themeColor="textSecondary">{w.spending}</ThemedText>
        <Pressable accessibilityRole="button" accessibilityLabel={p.periodLabel} onPress={p.onPeriod}
          style={[styles.period, { backgroundColor: p.theme.backgroundSelected }]}>
          <ThemedText type="meta">{p.periodLabel}</ThemedText>
          <Icon name="chevron-down" size={14} color={p.theme.textSecondary} />
        </Pressable>
      </View>
      <Pressable accessibilityRole="button" onPress={p.onSpending} testID="home-spending-total"
        accessibilityLabel={`${w.spending}, ${ledgerCurrencyCode()} ${formatAmount(p.expenseFils)}. ${w.viewSpending}`}
        style={styles.spending}>
        <Money fils={p.expenseFils} type="display" />
        <View style={styles.link}><ThemedText type="meta" style={{ color: p.theme.primary }}>{w.viewSpending}</ThemedText>
          <Icon name="arrow-up-right" size={16} color={p.theme.primary} /></View>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={p.onIncome} testID="home-income-summary"
        accessibilityLabel={`${w.income}, ${ledgerCurrencyCode()} ${formatAmount(p.incomeFils)}`}
        style={[styles.income, { borderColor: p.theme.cardBorder }, p.largeText && styles.stack]}>
        <View style={styles.link}><Icon name="arrow-down-right" size={16} color={p.theme.income} />
          <ThemedText type="meta" themeColor="textSecondary">{w.income}</ThemedText></View>
        <Money fils={p.incomeFils} type="smallBold" />
      </Pressable>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  root: { gap: 12 }, grow: { flex: 1, minWidth: 0, gap: 4 },
  wordmark: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 14 },
  dateLine: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerAction: { minWidth: 48, minHeight: 48, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  summary: { gap: 8, paddingBottom: 8 },
  summaryTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  period: { minHeight: 44, paddingHorizontal: 12, borderRadius: 4, flexDirection: 'row', alignItems: 'center', gap: 6 },
  spending: { minHeight: 100, justifyContent: 'center', alignItems: 'flex-start', gap: 10, paddingBottom: 12 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  income: { minHeight: 56, paddingVertical: 12, borderTopWidth: 1,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  stack: { flexDirection: 'column', alignItems: 'flex-start' },
});
