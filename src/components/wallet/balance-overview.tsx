import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
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
    <LinearGradient colors={['#174D3E', '#082E28']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
      <View style={styles.heroTitle}><ThemedText type="small" style={styles.onDark}>{t('availableBalances')}</ThemedText>
        <View accessible={false} style={styles.mark}><Icon name="leaf" size={56} color="#6DA18A" strokeWidth={1.5} /></View></View>
      <View style={[styles.money, p.largeText && styles.stack]} accessible
        accessibilityLabel={p.knownBalanceCount > 0 ? `${ledgerCurrencyDisplay()} ${formatAmount(p.balanceFils)}` : p.balanceCoverageText}>
        <ThemedText type="heading" style={styles.onDark}>{ledgerCurrencyDisplay()}</ThemedText>
        <ThemedText type="amount" tabular style={styles.onDark}>{p.knownBalanceCount > 0 ? formatAmount(p.balanceFils) : '—'}</ThemedText>
      </View>
      <ThemedText type="meta" style={styles.muted}>{p.balanceCoverageText}</ThemedText>
    </LinearGradient>
    {p.activeSourceCount === 0 ? <Button label={t('newAccount')} onPress={p.onAddAccount} icon="plus" /> : <>
      <Pressable accessibilityRole="button" accessibilityLabel={detailsLabel} accessibilityState={{ expanded: details }} onPress={() => setDetails(!details)} style={styles.disclosure}>
        <ThemedText type="meta" themeColor="textSecondary">{detailsLabel}</ThemedText>
        <Icon name={details ? 'chevron-down' : 'chevron-right'} size={16} color={p.theme.textSecondary} />
      </Pressable>
      {details && <View style={[styles.details, { backgroundColor: p.theme.card, borderColor: p.theme.cardBorder }]}>
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
  root: { gap: 8 }, hero: { borderRadius: 20, padding: 20, gap: 10, overflow: 'hidden' }, heroTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  onDark: { color: '#F5FBF7' }, muted: { color: '#C4DCD1' }, money: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 },
  mark: { position: 'absolute', right: 2, top: 3, opacity: 0.45 }, stack: { flexDirection: 'column', alignItems: 'flex-start' },
  disclosure: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 44 },
  details: { borderRadius: 18, borderWidth: 1, padding: 16, gap: 12 }, detailRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between', minHeight: 44, alignItems: 'center' },
});
