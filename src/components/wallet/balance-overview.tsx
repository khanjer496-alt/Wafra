import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/controls';
import { Colors } from '@/constants/theme';
import { formatAmount } from '@/lib/format';
import { t } from '@/lib/i18n';
import { ledgerCurrencyDisplay } from '@/lib/markets';


type BalanceOverviewProps = {
  balanceCoverageText: string; balanceFils: number; knownBalanceCount: number;
  activeSourceCount: number;
  largeText: boolean; theme: (typeof Colors)[keyof typeof Colors];
  onAddAccount: () => void;
};
export function BalanceOverview(p: BalanceOverviewProps) {
  return <View style={styles.root} testID="reference-account-balance">
    <View style={[styles.hero, { borderColor: p.theme.cardBorder }]} >
      <View style={styles.heroTitle}><ThemedText type="small" themeColor="textSecondary">{t('availableBalances')}</ThemedText>
</View>
      <View style={[styles.money, p.largeText && styles.stack]} accessible
        accessibilityLabel={p.knownBalanceCount > 0 ? `${ledgerCurrencyDisplay()} ${formatAmount(p.balanceFils)}` : p.balanceCoverageText}>
        <ThemedText type="meta" themeColor="textSecondary">{ledgerCurrencyDisplay()}</ThemedText>
        <ThemedText type="amount" tabular style={{ color: p.theme.text }}>{p.knownBalanceCount > 0 ? formatAmount(p.balanceFils) : '—'}</ThemedText>
      </View>
      <ThemedText type="meta" style={{ color: p.theme.textSecondary }}>{p.balanceCoverageText}</ThemedText>
    </View>
    {p.activeSourceCount === 0 ? <Button label={t('newAccount')} onPress={p.onAddAccount} icon="plus" /> : null}
  </View>;
}
const styles = StyleSheet.create({
  root: { gap: 8 }, hero: { paddingVertical: 12, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth }, heroTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
 money: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 },
   stack: { flexDirection: 'column', alignItems: 'flex-start' },
});
