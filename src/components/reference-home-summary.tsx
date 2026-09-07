import { homeSummaryCopy as copy } from '@/lib/reference-copy';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { WafraMark } from '@/components/wafra-logo';
import { Icon, type IconName } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import type { Colors } from '@/constants/theme';
import { formatAmount } from '@/lib/format';
import { ledgerCurrencyCode } from '@/lib/markets';

type Props = {
  theme: typeof Colors.light; language: string; largeText: boolean;
  greeting: string; dateLabel: string; periodLabel: string;
  balanceFils: number | null; balanceCoverage: string;
  incomeFils: number; expenseFils: number; netFils: number;
  onPeriod: () => void; onAdd: () => void; onImport: () => void;
  onAccounts: () => void; onSettings: () => void;
  onIncome: () => void; onSpending: () => void;
};

/** Ledger & Light: one focal figure, open space, exact money, thin rules.
 * These are the current ledger's figures, not a rollback to historical maths. */
export function ReferenceHomeSummary(p: Props) {
  const w = copy[p.language === 'ar' ? 'ar' : 'en'];
  const known = p.balanceFils !== null;
  const actions: { label: string; icon: IconName; press: () => void }[] = [
    { label: w.add, icon: 'plus', press: p.onAdd },
    { label: w.import, icon: 'download', press: p.onImport },
    { label: w.accounts, icon: 'wallet', press: p.onAccounts },
    { label: w.settings, icon: 'sliders', press: p.onSettings },
  ];
  return <View style={styles.root} testID="reference-home-summary">
    <View style={styles.header}>
      <View style={styles.wordmark}><WafraMark size={28} /><ThemedText type="title">Wafra</ThemedText></View>
      <Pressable accessibilityRole="button" accessibilityLabel={w.settings} onPress={p.onSettings}
        style={({ pressed }) => [styles.headerAction, { opacity: pressed ? 0.7 : 1 }]}>
        <Icon name="sliders" size={21} color={p.theme.textSecondary} />
      </Pressable>
    </View>
    <View style={styles.dateLine}>
      <ThemedText type="meta" themeColor="textSecondary">{p.greeting}</ThemedText>
      <ThemedText type="meta" themeColor="textTertiary">{p.dateLabel}</ThemedText>
    </View>
    <View style={[styles.hero, { borderColor: p.theme.cardBorder }]} testID="journal-summary">
      <ThemedText type="micro" themeColor="textSecondary">{known ? w.balance : w.net}</ThemedText>
      <View style={[styles.amountRow, p.largeText && styles.stack]} accessible
        accessibilityLabel={`${known ? w.balance : w.net}, ${ledgerCurrencyCode()} ${formatAmount(known ? p.balanceFils! : p.netFils)}`}>
        <ThemedText type="meta" themeColor="textSecondary">{ledgerCurrencyCode()}</ThemedText>
        <Money fils={known ? p.balanceFils! : p.netFils} type="display" prefix={false} color={p.theme.text} />
      </View>
      <ThemedText type="meta" themeColor="textSecondary">{known ? p.balanceCoverage : w.notBalance}</ThemedText>
      <Pressable onPress={known ? p.onAccounts : p.onSpending} accessibilityRole="button"
        style={styles.heroLink} accessibilityLabel={known ? w.balanceDetail : w.spending}>
        <ThemedText type="meta" themeColor="textTertiary" style={styles.grow}>{known ? w.balanceNote : w.period}</ThemedText>
        <Icon name="chevron-right" size={16} color={p.theme.textTertiary} />
      </Pressable>
    </View>
    <View style={[styles.quickActions, p.largeText && styles.quickActionsLarge]} testID="reference-quick-actions">
      {actions.map((action) => <Pressable key={action.label} accessibilityRole="button" accessibilityLabel={action.label}
        onPress={action.press} android_ripple={{ color: p.theme.backgroundSelected }}
        style={({ pressed }) => [styles.quickAction, { backgroundColor: pressed ? p.theme.backgroundSelected : 'transparent' }]}>
        <Icon name={action.icon} size={19} color={p.theme.primary} />
        <ThemedText type="meta" style={styles.quickLabel}>{action.label}</ThemedText>
      </Pressable>)}
    </View>
    <Pressable onPress={p.onPeriod} accessibilityRole="button" accessibilityLabel={p.periodLabel} style={styles.periodRow}>
      <ThemedText type="micro" themeColor="textSecondary">{w.period}</ThemedText>
      <View style={styles.periodLabel}><ThemedText type="meta" themeColor="textSecondary">{p.periodLabel}</ThemedText>
        <Icon name="chevron-down" size={14} color={p.theme.textSecondary} /></View>
    </Pressable>
    <View style={[styles.facts, p.largeText && styles.stack, { borderColor: p.theme.cardBorder }]} testID="reference-month-cards">
      {[{ label: w.spending, value: p.expenseFils, icon: 'arrow-up-right' as const, press: p.onSpending, color: p.theme.expense },
        { label: w.income, value: p.incomeFils, icon: 'arrow-down-right' as const, press: p.onIncome, color: p.theme.income }].map((fact) =>
        <Pressable key={fact.label} onPress={fact.press} accessibilityRole="button"
          accessibilityLabel={`${fact.label}, ${ledgerCurrencyCode()} ${formatAmount(fact.value)}`}
          style={({ pressed }) => [styles.fact, p.largeText && styles.factLarge, { backgroundColor: pressed ? p.theme.backgroundSelected : 'transparent' }]}>
          <View style={styles.factTop}><Icon name={fact.icon} size={15} color={fact.color} />
            <ThemedText type="meta" themeColor="textSecondary">{fact.label}</ThemedText></View>
          <Money fils={fact.value} type="heading" />
        </Pressable>)}
    </View>
    {known && <Pressable onPress={p.onSpending} accessibilityRole="button"
      accessibilityLabel={`${w.net}, ${ledgerCurrencyCode()} ${formatAmount(p.netFils)}. ${w.notBalance}`}
      style={styles.netRow} testID="reference-period-net">
      <View style={styles.grow}><ThemedText type="meta" themeColor="textSecondary">{w.net}</ThemedText>
        <ThemedText type="meta" themeColor="textTertiary">{w.notBalance}</ThemedText></View>
      <Money fils={p.netFils} type="smallBold" prefix={false} />
      <Icon name="chevron-right" size={16} color={p.theme.textTertiary} />
    </Pressable>}
  </View>;
}
const styles = StyleSheet.create({
  root: { gap: 12 }, grow: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  headerAction: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  dateLine: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
  hero: { paddingTop: 20, paddingBottom: 8, gap: 10, borderBottomWidth: 1 },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 10 },
  stack: { flexDirection: 'column', alignItems: 'flex-start' },
  heroLink: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12 },
  quickActions: { flexDirection: 'row', gap: 8 }, quickActionsLarge: { flexWrap: 'wrap' },
  quickAction: { flex: 1, minWidth: 56, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 6 },
  quickLabel: { textAlign: 'center' },
  periodRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, minHeight: 44 },
  periodLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  facts: { flexDirection: 'row', gap: 16, borderTopWidth: 1, borderBottomWidth: 1 },
  fact: { flex: 1, minWidth: 0, minHeight: 86, paddingVertical: 14, gap: 10 }, factLarge: { width: '100%', flex: 0 },
  factTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  netRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, minHeight: 56 },
});
