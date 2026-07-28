import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getCategory } from '@/lib/categories';
import { formatAmount } from '@/lib/format';
import { getActiveMarket } from '@/lib/markets';
import type { Account, Transaction } from '@/lib/types';

interface TransactionRowProps {
  transaction: Transaction;
  account?: Account;
  onPress?: () => void;
}

/**
 * One entry: the mark, what it was, what it cost.
 *
 * Only money in is coloured. An expense row painted red says "something is
 * wrong" about a cup of coffee — and when every row says it, none of them do.
 */
export function TransactionRow({ transaction, account, onPress }: TransactionRowProps) {
  const theme = useTheme();
  const meta = getCategory(transaction.category);
  const isIncome = transaction.type === 'income';
  const where = transaction.isTransfer ? 'Transfer' : meta.label;

  // Spoken as one sentence. Left to itself RN would concatenate the children,
  // which reads the sign as a stray "minus" and drops the currency entirely —
  // "ENOC Fuel Transport · FAB Credit Card − 113".
  const label = [
    transaction.title,
    where,
    account?.name,
    `${isIncome ? 'plus' : 'minus'} ${formatAmount(transaction.amountFils, { decimals: false })} ${getActiveMarket().currency.code}`,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { transform: [{ scale: 0.985 }] }]}>
      <MerchantAvatar title={transaction.title} category={transaction.category} size={34} />
      <View style={styles.middle}>
        <ThemedText type="small" numberOfLines={1}>
          {transaction.title}
        </ThemedText>
        <ThemedText type="meta" themeColor="textTertiary" numberOfLines={1}>
          {where}
          {account ? ` · ${account.name}` : ''}
        </ThemedText>
      </View>
      <ThemedText type="small" tabular style={{ color: isIncome ? theme.income : theme.text }}>
        {isIncome ? '+' : '−'}
        {formatAmount(transaction.amountFils, { decimals: false })}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 4,
    paddingVertical: 11,
  },
  middle: {
    flex: 1,
    gap: 1,
  },
});
