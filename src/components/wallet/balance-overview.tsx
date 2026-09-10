import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Button } from '@/components/ui/controls';
import { Colors } from '@/constants/theme';
import { formatAED, formatAmount } from '@/lib/format';
import { t, tf } from '@/lib/i18n';
import { ledgerCurrencyDisplay } from '@/lib/markets';


type BalanceOverviewProps = {
  balanceCoverageText: string; balanceFils: number; knownBalanceCount: number;
  duesTotalFils: number; cashOutTotalFils: number; cashOutCardPaymentsFils: number; cashOutAccountOutflowFils: number;
  currencies: readonly { currency: string }[]; currenciesTotalFils: number; activeSourceCount: number;
  largeText: boolean; theme: (typeof Colors)[keyof typeof Colors];
  onOpenBills: () => void; onOpenCurrency: () => void; onAddAccount: () => void;
};
export function BalanceOverview(p: BalanceOverviewProps) {
  const [details, setDetails] = useState(false);
  const detailsLabel = t('refDuesAndMovements');
  return <View style={styles.root} testID="reference-account-balance">
    <View style={[styles.hero, { borderColor: p.theme.cardBorder }]} >
      <View style={styles.heroTitle}><ThemedText type="micro" themeColor="textSecondary">{t('availableBalances')}</ThemedText>
</View>
      <View style={[styles.money, p.largeText && styles.stack]} accessible
        accessibilityLabel={p.knownBalanceCount > 0 ? `${ledgerCurrencyDisplay()} ${formatAmount(p.balanceFils)}` : p.balanceCoverageText}>
        <ThemedText type="heading" style={{ color: p.theme.text }}>{ledgerCurrencyDisplay()}</ThemedText>
        <ThemedText type="amount" tabular style={{ color: p.theme.text }}>{p.knownBalanceCount > 0 ? formatAmount(p.balanceFils) : '—'}</ThemedText>
      </View>
      <ThemedText type="meta" style={{ color: p.theme.textSecondary }}>{p.balanceCoverageText}</ThemedText>
    </View>
    {p.activeSourceCount === 0 ? <Button label={t('newAccount')} onPress={p.onAddAccount} icon="plus" /> : <>
      <Pressable accessibilityRole="button" accessibilityLabel={detailsLabel} accessibilityState={{ expanded: details }} onPress={() => setDetails(!details)} style={styles.disclosure}>
        <ThemedText type="meta" themeColor="textSecondary">{detailsLabel}</ThemedText>
        <Icon name={details ? 'chevron-down' : 'chevron-right'} size={16} color={p.theme.textSecondary} />
      </Pressable>
      {details && <View style={[styles.details, { backgroundColor: 'transparent', borderColor: p.theme.cardBorder }]}>
        <Pressable accessibilityRole="button" onPress={p.onOpenBills} style={[styles.detailRow, p.largeText && styles.stack]}>
          <ThemedText type="small">{t('cardPaymentsDue')}</ThemedText>
          <ThemedText type="smallBold" tabular>{formatAED(p.duesTotalFils)}</ThemedText>
        </Pressable>
        <View style={[styles.detailRow, p.largeText && styles.stack]}><ThemedText type="small">{t('paidFromAccounts')}</ThemedText>
          <ThemedText type="smallBold" tabular>{formatAED(p.cashOutTotalFils)}</ThemedText></View>
        <ThemedText type="meta" themeColor="textSecondary">{tf('cashOutBreakdown', {
          cards: formatAED(p.cashOutCardPaymentsFils), accounts: formatAED(p.cashOutAccountOutflowFils),
        })}</ThemedText>
        {p.currencies.length > 0 && <Pressable accessibilityRole="button" onPress={p.onOpenCurrency} style={[styles.detailRow, p.largeText && styles.stack]}>
          <ThemedText type="small">{t('currencyActivityTitle')}</ThemedText>
          <ThemedText type="smallBold" tabular>{formatAED(p.currenciesTotalFils)}</ThemedText>
        </Pressable>}
      </View>}
    </>}
  </View>;
}
const styles = StyleSheet.create({
  root: { gap: 8 }, hero: { paddingVertical: 12, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth }, heroTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
 money: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 },
   stack: { flexDirection: 'column', alignItems: 'flex-start' },
  disclosure: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 44 },
  details: { paddingVertical: 16, borderTopWidth: 1, gap: 12 }, detailRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between', minHeight: 44, alignItems: 'center' },
});
