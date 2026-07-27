import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getCategory } from '@/lib/categories';
import { formatAmount } from '@/lib/format';
import type { Account, Transaction } from '@/lib/types';

interface TransactionRowProps {
  transaction: Transaction;
  account?: Account;
  /** Receives the entry, so callers can pass one stable handler for the list. */
  onPress?: (transaction: Transaction) => void;
}

/**
 * One entry: the mark, what it was, what it cost.
 *
 * Only money in is coloured. An expense row painted red says "something is
 * wrong" about a cup of coffee — and when every row says it, none of them do.
 */
function TransactionRowInner({ transaction, account, onPress }: TransactionRowProps) {
  const theme = useTheme();
  const press = onPress ? () => onPress(transaction) : undefined;
  const meta = getCategory(transaction.category);
  const isIncome = transaction.type === 'income';

  return (
    <Pressable
      onPress={press}
      style={({ pressed }) => [styles.row, pressed && { transform: [{ scale: 0.985 }] }]}>
      <MerchantAvatar title={transaction.title} category={transaction.category} size={34} />
      <View style={styles.middle}>
        <ThemedText type="small" numberOfLines={1}>
          {transaction.title}
        </ThemedText>
        <ThemedText type="meta" themeColor="textTertiary" numberOfLines={1}>
          {transaction.isTransfer ? 'Transfer' : meta.label}
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

/**
 * Memoised, because this is the component the app renders most.
 *
 * A SectionList re-runs `renderItem` for every row on screen whenever its
 * parent re-renders, and Activity's parent re-renders on every keystroke in
 * the search field and on every store change. Fifteen rows, each rebuilding an
 * avatar and two text nodes, on every character typed.
 *
 * The memo only holds if the props are stable, which is why `onPress` takes
 * the entry instead of closing over it: `() => setEditing(item)` is a new
 * function on every render and defeats the comparison entirely.
 */
export const TransactionRow = React.memo(TransactionRowInner);

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
