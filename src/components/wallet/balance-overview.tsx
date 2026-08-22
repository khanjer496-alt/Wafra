import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { formatAED, formatAmount } from '@/lib/format';
import { t, tf } from '@/lib/i18n';
import { ledgerCurrencyDisplay } from '@/lib/markets';

type BalanceOverviewProps = {
  balanceCoverageText: string;
  balanceFils: number;
  knownBalanceCount: number;
  duesTotalFils: number;
  cashOutTotalFils: number;
  cashOutCardPaymentsFils: number;
  cashOutAccountOutflowFils: number;
  currencies: readonly { currency: string }[];
  currenciesTotalFils: number;
  activeSourceCount: number;
  cardCount: number;
  largeText: boolean;
  theme: (typeof Colors)[keyof typeof Colors];
  onOpenBills: () => void;
  onOpenCurrency: () => void;
  onOpenCards: () => void;
};

export function BalanceOverview({
  balanceCoverageText,
  balanceFils,
  knownBalanceCount,
  duesTotalFils,
  cashOutTotalFils,
  cashOutCardPaymentsFils,
  cashOutAccountOutflowFils,
  currencies,
  currenciesTotalFils,
  activeSourceCount,
  cardCount,
  largeText,
  theme,
  onOpenBills,
  onOpenCurrency,
  onOpenCards,
}: BalanceOverviewProps) {
  return (
    <View style={[styles.overviewCard, { backgroundColor: theme.backgroundElement, borderColor: theme.cardBorder }]}>
      <View style={styles.overviewHeader}>
        <View style={styles.overviewHeaderCopy}>
          <ThemedText type="smallBold">{t('availableBalances')}</ThemedText>
          <ThemedText type="meta" themeColor="textSecondary">{balanceCoverageText}</ThemedText>
        </View>
        <View style={[styles.overviewMark, { backgroundColor: theme.primarySoft }]}>
          <Icon name="bank" size={18} color={theme.primary} />
        </View>
      </View>

      <View style={[styles.overviewAmount, largeText && styles.overviewAmountLarge]}>
        <ThemedText accessible={false} type="smallBold" themeColor="textSecondary" tabular style={styles.currency}>
          {ledgerCurrencyDisplay()}
        </ThemedText>
        <ThemedText
          type="amount"
          tabular
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.58}
          accessibilityLabel={knownBalanceCount > 0 ? `${ledgerCurrencyDisplay()} ${formatAmount(balanceFils)}` : undefined}>
          {knownBalanceCount > 0 ? formatAmount(balanceFils, { decimals: false }) : '—'}
        </ThemedText>
      </View>

      <View style={[styles.snapshotGrid, largeText && styles.snapshotGridLarge]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('cardPaymentsDue')}, ${formatAED(duesTotalFils, { decimals: false })}`}
          onPress={onOpenBills}
          style={({ pressed }) => [styles.snapshotFact, { borderColor: theme.controlBorder, backgroundColor: pressed ? theme.backgroundSelected : theme.background }]}>
          <ThemedText type="meta" themeColor="textSecondary">{t('cardPaymentsDue')}</ThemedText>
          <ThemedText type="smallBold" tabular style={{ color: theme.expense }}>{formatAED(duesTotalFils, { decimals: false })}</ThemedText>
        </Pressable>

        <View
          accessible
          accessibilityLabel={`${t('paidFromAccounts')}, ${formatAED(cashOutTotalFils, { decimals: false })}. ${tf('cashOutBreakdown', {
            cards: formatAED(cashOutCardPaymentsFils, { decimals: false }),
            accounts: formatAED(cashOutAccountOutflowFils, { decimals: false }),
          })}`}
          style={[styles.snapshotFact, { borderColor: theme.cardBorder, backgroundColor: theme.background }]}>
          <ThemedText type="meta" themeColor="textSecondary">{t('paidFromAccounts')}</ThemedText>
          <ThemedText type="smallBold" tabular>{formatAED(cashOutTotalFils, { decimals: false })}</ThemedText>
        </View>

        {currencies.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t('currencyActivityTitle')}, ${formatAED(currenciesTotalFils, { decimals: false })}`}
            onPress={onOpenCurrency}
            style={({ pressed }) => [styles.snapshotFact, { borderColor: theme.controlBorder, backgroundColor: pressed ? theme.backgroundSelected : theme.background }]}>
            <ThemedText type="meta" themeColor="textSecondary">{t('currencyActivityTitle')}</ThemedText>
            <ThemedText type="smallBold" tabular>{formatAED(currenciesTotalFils, { decimals: false })}</ThemedText>
            <ThemedText type="nano" themeColor="textTertiary" numberOfLines={1}>
              {currencies.slice(0, 3).map((group) => group.currency).join(' · ')}
            </ThemedText>
          </Pressable>
        ) : (
          <View
            accessible
            accessibilityLabel={`${t('moneySourcesHeader')}, ${activeSourceCount}`}
            style={[styles.snapshotFact, { borderColor: theme.cardBorder, backgroundColor: theme.background }]}>
            <ThemedText type="meta" themeColor="textSecondary">{t('moneySourcesHeader')}</ThemedText>
            <ThemedText type="smallBold" tabular>{activeSourceCount}</ThemedText>
          </View>
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('cardsHeader')}, ${cardCount}`}
          onPress={onOpenCards}
          style={({ pressed }) => [styles.snapshotFact, { borderColor: theme.controlBorder, backgroundColor: pressed ? theme.backgroundSelected : theme.background }]}>
          <ThemedText type="meta" themeColor="textSecondary">{t('cardsHeader')}</ThemedText>
          <ThemedText type="smallBold" tabular>{cardCount}</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overviewCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.bottomSheet, padding: Spacing.four, gap: Spacing.three, marginTop: -Spacing.two },
  overviewHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  overviewHeaderCopy: { flex: 1, minWidth: 0, gap: 2 },
  overviewMark: { width: 38, height: 38, borderRadius: Radius.tile, alignItems: 'center', justifyContent: 'center' },
  overviewAmount: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  overviewAmountLarge: { flexWrap: 'wrap' },
  currency: { fontSize: 15, lineHeight: 20 },
  snapshotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  snapshotGridLarge: { flexDirection: 'column', flexWrap: 'nowrap' },
  snapshotFact: { flexBasis: '47%', flexGrow: 1, minHeight: 76, borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.md, padding: Spacing.three, justifyContent: 'space-between', gap: Spacing.half },
});
