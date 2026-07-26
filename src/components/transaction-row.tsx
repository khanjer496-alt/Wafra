import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getCategory } from '@/lib/categories';
import { formatAED } from '@/lib/format';
import type { Account, Transaction } from '@/lib/types';

interface TransactionRowProps {
  transaction: Transaction;
  account?: Account;
  onPress?: () => void;
}

export function TransactionRow({ transaction, account, onPress }: TransactionRowProps) {
  const theme = useTheme();
  const meta = getCategory(transaction.category);
  const isIncome = transaction.type === 'income';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
      <MerchantAvatar title={transaction.title} category={transaction.category} />
      <View style={styles.middle}>
        <ThemedText numberOfLines={1}>{transaction.title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {transaction.isTransfer ? 'Transfer' : meta.label}
          {account ? ` · ${account.name}` : ''}
        </ThemedText>
      </View>
      <ThemedText tabular style={{ color: isIncome ? theme.income : theme.text, fontWeight: '700' }}>
        {isIncome ? '+' : '−'}{formatAED(transaction.amountFils, { decimals: false })}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two + 2,
  },
  middle: {
    flex: 1,
    gap: 1,
  },
});
