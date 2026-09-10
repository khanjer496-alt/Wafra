import { homeSummaryCopy as copy } from '@/lib/reference-copy';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { WafraMark } from '@/components/wafra-logo';
import { Money } from '@/components/ui/money';
import type { Colors } from '@/constants/theme';
import { formatMinorUnits, type LedgerMoneySpec } from '@/lib/ledger-money';

type Props = {
  theme: typeof Colors.light;
  language: string;
  largeText: boolean;
  greeting: string;
  dateLabel: string;
  periodLabel: string;
  incomeFils: number;
  expenseFils: number;
  netFils: number;
  unresolvedTransferCount: number;
  unresolvedIncomingFils: number;
  unresolvedOutgoingFils: number;
  moneySpec: LedgerMoneySpec;
  onPeriod: () => void;
  onAdd: () => void;
  onSettings: () => void;
  onIncome: () => void;
  onSpending: () => void;
};

/** One period, three reconciled figures. Account balances belong in Accounts. */
export function ReferenceHomeSummary(p: Props) {
  const w = copy[p.language === 'ar' ? 'ar' : 'en'];
  const netSign = p.netFils < 0 ? '−' : p.netFils > 0 ? '+' : '';
  const netColor = p.netFils < 0 ? p.theme.expense : p.netFils > 0 ? p.theme.income : p.theme.text;
  const currency = p.moneySpec.currency;
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
        <ThemedText type="small" themeColor="textSecondary">{w.moneyOut}</ThemedText>
        <Pressable accessibilityRole="button" accessibilityLabel={p.periodLabel} onPress={p.onPeriod}
          style={[styles.period, { backgroundColor: p.theme.backgroundSelected }]}>
          <ThemedText type="meta">{p.periodLabel}</ThemedText>
          <Icon name="chevron-down" size={14} color={p.theme.textSecondary} />
        </Pressable>
      </View>
      <Pressable accessibilityRole="button" onPress={p.onSpending} testID="home-spending-total"
        accessibilityLabel={`${w.moneyOut}, ${currency} ${formatMinorUnits(Math.round(p.expenseFils), p.moneySpec)}. ${w.viewSpending}`}
        style={styles.spending}>
        <Money fils={p.expenseFils} moneySpec={p.moneySpec} type="display" />
        <View style={styles.link}><ThemedText type="meta" style={{ color: p.theme.primary }}>{w.viewSpending}</ThemedText>
          <Icon name="arrow-up-right" size={16} color={p.theme.primary} /></View>
      </Pressable>
      <View style={[styles.metrics, { borderColor: p.theme.cardBorder }, p.largeText && styles.stack]}>
      <Pressable accessibilityRole="button" onPress={p.onIncome} testID="home-income-summary"
        accessibilityLabel={`${w.moneyIn}, ${currency} ${formatMinorUnits(Math.round(p.incomeFils), p.moneySpec)}`}
        style={[styles.metric, p.largeText && styles.metricStacked]}>
        <View style={styles.link}><Icon name="arrow-down-right" size={16} color={p.theme.income} />
          <ThemedText type="small" themeColor="textSecondary">{w.moneyIn}</ThemedText></View>
        <Money fils={p.incomeFils} moneySpec={p.moneySpec} type="smallBold" color={p.theme.income} />
      </Pressable>
      <View testID="home-net-summary" accessible accessibilityRole="text"
        accessibilityLabel={`${w.netLabel}, ${currency} ${netSign}${formatMinorUnits(Math.round(Math.abs(p.netFils)), p.moneySpec)}. ${w.cashflowNote}`}
        style={[styles.metric, p.largeText && styles.metricStacked]}>
        <ThemedText type="small" themeColor="textSecondary">{w.netLabel}</ThemedText>
        <Money fils={p.netFils} moneySpec={p.moneySpec} type="smallBold" sign={p.netFils === 0 ? 'none' : 'auto'} color={netColor} />
      </View>
      </View>
      {p.incomeFils === 0 && <ThemedText type="meta" themeColor="textSecondary" testID="home-no-income-note">
        {w.noIncome}</ThemedText>}
      <ThemedText type="meta" themeColor="textSecondary">{w.cashflowNote}</ThemedText>
      {p.unresolvedTransferCount > 0 && <View testID="home-unresolved-transfer-summary"
        style={[styles.unclearTransfers, { borderColor: p.theme.cardBorder }]}>
        <View style={styles.unclearHeading}>
          <ThemedText type="smallBold">{w.unclearTransfers}</ThemedText>
          <ThemedText type="meta" themeColor="textSecondary">{p.unresolvedTransferCount}</ThemedText>
        </View>
        <ThemedText type="meta" themeColor="textSecondary">{w.unclearTransferNote}</ThemedText>
        <ThemedText type="meta" tabular themeColor="textSecondary">
          {currency} {formatMinorUnits(Math.round(p.unresolvedIncomingFils), p.moneySpec)} {w.unclearIn}
          {' · '}{currency} {formatMinorUnits(Math.round(p.unresolvedOutgoingFils), p.moneySpec)} {w.unclearOut}
        </ThemedText>
      </View>}
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
  spending: { minHeight: 88, justifyContent: 'center', alignItems: 'flex-start', gap: 6, paddingBottom: 12 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: StyleSheet.hairlineWidth, gap: 16, paddingVertical: 12 },
  metric: { flexGrow: 1, flexShrink: 1, flexBasis: '42%', minWidth: 120, minHeight: 48, gap: 6 },
  unclearTransfers: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, gap: 4 },
  unclearHeading: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  metricStacked: { flexBasis: 'auto', alignSelf: 'stretch' },
  stack: { flexDirection: 'column', alignItems: 'flex-start' },
});
