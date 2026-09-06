import { homeSummaryCopy as copy } from '@/lib/reference-copy';
/** Approved forest/cream reference: presentation only. No invented balance history. */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ThemedText } from '@/components/themed-text';
import { Icon, type IconName } from '@/components/ui/icon';
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
  balanceFils: number | null;
  balanceCoverage: string;
  incomeFils: number;
  expenseFils: number;
  netFils: number;
  onPeriod: () => void;
  onAdd: () => void;
  onImport: () => void;
  onAccounts: () => void;
  onSettings: () => void;
  onIncome: () => void;
  onSpending: () => void;
};



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
      <View style={styles.grow}>
        <ThemedText type="meta" themeColor="textSecondary" style={styles.greeting}>{p.greeting}</ThemedText>
        <ThemedText type="title" style={styles.brand}>Wafra</ThemedText>
        <ThemedText type="meta" themeColor="textTertiary">{p.dateLabel}</ThemedText>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={w.settings} onPress={p.onSettings}
        style={({ pressed }) => [styles.headerAction, { opacity: pressed ? 0.7 : 1 }]}>
        <Icon name="sliders" size={22} color={p.theme.text} />
      </Pressable>
    </View>

    <LinearGradient colors={['#20483F', '#102F2D']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={styles.hero} testID="journal-summary">
      <View style={styles.heroTop}>
        <ThemedText type="small" style={styles.onDark}>{known ? w.balance : w.net}</ThemedText>
        <Icon name="wallet" size={18} color="#C4DAD2" />
      </View>
      <View style={[styles.amountRow, p.largeText && styles.amountRowLarge]} accessible
        accessibilityLabel={`${known ? w.balance : w.net}, ${ledgerCurrencyCode()} ${formatAmount(known ? p.balanceFils! : p.netFils)}`}>
        <ThemedText type="heading" style={styles.currency}>{ledgerCurrencyCode()}</ThemedText>
        <Money fils={known ? p.balanceFils! : p.netFils} type="amount" prefix={false} color="#FFFFFF" />
      </View>
      <ThemedText type="meta" style={styles.onDarkMuted}>{known ? p.balanceCoverage : w.notBalance}</ThemedText>
      <Pressable onPress={known ? p.onAccounts : p.onSpending} accessibilityRole="button"
        style={styles.heroLink} accessibilityLabel={known ? w.balanceDetail : w.spending}>
        <ThemedText type="meta" style={styles.onDarkMuted}>{known ? w.balanceNote : w.period}</ThemedText>
        <Icon name="chevron-right" size={17} color="#BFD7CD" />
      </Pressable>
    </LinearGradient>

    <View style={[styles.quickActions, p.largeText && styles.quickActionsLarge]} testID="reference-quick-actions">
      {actions.map((action) => <Pressable key={action.label} accessibilityRole="button" accessibilityLabel={action.label}
        onPress={action.press} style={({ pressed }) => [styles.quickAction, { opacity: pressed ? 0.65 : 1 }]}>
        <View style={[styles.quickCircle, { backgroundColor: p.theme.backgroundElement, borderColor: p.theme.cardBorder }]}>
          <Icon name={action.icon} size={22} color={p.theme.text} />
        </View>
        <ThemedText type="meta" style={styles.quickLabel}>{action.label}</ThemedText>
      </Pressable>)}
    </View>

    <Pressable onPress={p.onPeriod} accessibilityRole="button" accessibilityLabel={p.periodLabel}
      style={styles.periodRow}>
      <ThemedText type="smallBold">{w.period}</ThemedText>
      <View style={styles.periodLabel}><ThemedText type="meta" themeColor="textSecondary">{p.periodLabel}</ThemedText>
        <Icon name="chevron-down" size={14} color={p.theme.textSecondary} /></View>
    </Pressable>
    <View style={[styles.facts, p.largeText && styles.factsLarge]} testID="reference-month-cards">
      {[{ label: w.spending, value: p.expenseFils, icon: 'arrow-up-right' as const, press: p.onSpending },
        { label: w.income, value: p.incomeFils, icon: 'arrow-down-right' as const, press: p.onIncome }].map((fact) =>
        <Pressable key={fact.label} onPress={fact.press} accessibilityRole="button"
          accessibilityLabel={`${fact.label}, ${ledgerCurrencyCode()} ${formatAmount(fact.value)}`}
          style={({ pressed }) => [styles.fact, { backgroundColor: pressed ? p.theme.backgroundSelected : p.theme.backgroundElement,
            borderColor: p.theme.cardBorder }]}>
          <View style={styles.factTop}><ThemedText type="meta" themeColor="textSecondary">{fact.label}</ThemedText>
            <Icon name={fact.icon} size={15} color={p.theme.textSecondary} /></View>
          <Money fils={fact.value} type="heading" />
        </Pressable>)}
    </View>
    {known && <Pressable onPress={p.onSpending} accessibilityRole="button" style={[styles.insight, {
      backgroundColor: p.theme.primarySoft, borderColor: p.theme.primaryBorder,
    }]} testID="reference-period-net">
      <View style={[styles.insightIcon, { backgroundColor: p.theme.backgroundElement }]}>
        <Icon name="chart" size={23} color={p.theme.primary} /></View>
      <View style={styles.grow}>
        <ThemedText type="smallBold">{w.net} · {formatAmount(p.netFils)}</ThemedText>
        <ThemedText type="meta" themeColor="textSecondary">{w.notBalance}</ThemedText>
      </View>
      <Icon name="chevron-right" size={16} color={p.theme.primary} />
    </Pressable>}
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 16 },
  grow: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 2 },
  greeting: { fontSize: 15, lineHeight: 22 },
  brand: { fontSize: 28, lineHeight: 36, marginVertical: 2 },
  headerAction: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  hero: { padding: 20, borderRadius: 20, borderWidth: 1, borderColor: '#38574F', gap: 9, overflow: 'hidden' },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  onDark: { color: '#F3F8F5' },
  onDarkMuted: { color: '#C4DAD2', fontSize: 12, lineHeight: 18 },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', paddingVertical: 3 },
  amountRowLarge: { alignItems: 'flex-start' },
  currency: { color: '#FFFFFF', fontSize: 32, lineHeight: 40 },
  heroLink: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14 },
  quickActions: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, paddingTop: 1, paddingBottom: 2 },
  quickActionsLarge: { flexWrap: 'wrap' },
  quickAction: { flex: 1, minWidth: 56, minHeight: 78, alignItems: 'center', gap: 8 },
  quickCircle: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { textAlign: 'center', fontSize: 14, lineHeight: 18 },
  periodRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, minHeight: 44, marginBottom: -10 },
  periodLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  facts: { flexDirection: 'row', gap: 12 },
  factsLarge: { flexDirection: 'column' },
  fact: { flex: 1, minHeight: 92, padding: 14, borderRadius: 16, borderWidth: 1, gap: 12 },
  factTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  insight: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, borderWidth: 1, padding: 14 },
  insightIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
});
