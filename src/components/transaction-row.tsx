import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { categoryLabel, getCategory } from '@/lib/categories';
import { clockTime, formatAmount } from '@/lib/format';
import { isUnassignedAccountRef } from '@/lib/ledger';
import { getActiveMarket } from '@/lib/markets';
import type { Account, Transaction } from '@/lib/types';
import { t } from '@/lib/i18n';

interface TransactionRowProps {
  transaction: Transaction;
  account?: Account;
  /** Receives the entry, so callers can pass one stable handler for the list. */
  onPress?: (transaction: Transaction) => void;
  /** This row is one leg of a move between the user's own accounts. */
  internal?: boolean;
}

/**
 * One entry: the mark, what it was, what it cost.
 *
 * Only money in is coloured. An expense row painted red says "something is
 * wrong" about a cup of coffee — and when every row says it, none of them do.
 */
function TransactionRowInner({ transaction, account, onPress, internal }: TransactionRowProps) {
  const theme = useTheme();
  const language = useLanguage();
  const press = onPress ? () => onPress(transaction) : undefined;
  const meta = getCategory(transaction.category);
  const clock = clockTime(transaction);
  // A move between the user's own accounts, paired with its other leg.
  //
  // Only the LEAVING side carries `isTransfer`; the bank words the arriving
  // side exactly like being paid. So the row for money landing in your own
  // second account was painted green with a + on it, and the list read as
  // income arriving twice — which is precisely what it looked like.
  const isTransfer = transaction.isTransfer || internal === true;
  /**
   * Green, and read as money earned. A transfer is deliberately excluded: the
   * arriving leg of a move between your own accounts is worded by the bank
   * exactly like being paid, and painting it as income made the list look like
   * the same money landed twice.
   */
  const isIncome = transaction.type === 'income' && !isTransfer;
  /**
   * Which way the money went — NOT the same question as whether it was earned.
   *
   * The two used to be one flag, so an arriving transfer was given a minus:
   * "Inward remittance −265" for money that had just landed in the account.
   * Being excluded from income is a statement about what a movement COUNTS as;
   * it is not licence to state the wrong direction. The colour still separates
   * earned from moved, which is all the original rule actually needed.
   */
  const arrived = transaction.type === 'income';
  const where = isTransfer ? t('transferLabel', language) : categoryLabel(meta, language);
  const accountName =
    account?.name ??
    (isUnassignedAccountRef(transaction.accountId) ? t('unassigned', language) : undefined);

  // Spoken as one sentence. Left to itself RN would concatenate the children,
  // which reads the sign as a stray "minus" and drops the currency entirely —
  // "ENOC Fuel Transport · FAB Credit Card − 113".
  const label = [
    transaction.title,
    where,
    accountName,
    clock,
    `${arrived ? t('plusWord', language) : t('minusWord', language)} ${formatAmount(transaction.amountFils, { decimals: false })} ${getActiveMarket().currency.code}`,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={press}
      style={({ pressed }) => [styles.row, pressed && { transform: [{ scale: 0.985 }] }]}>
      <MerchantAvatar title={transaction.title} category={transaction.category} size={34} />
      <View style={styles.middle}>
        <ThemedText type="small" numberOfLines={1}>
          {transaction.title}
        </ThemedText>
        <ThemedText type="meta" themeColor="textTertiary" numberOfLines={1}>
          {where}
          {accountName ? ` · ${accountName}` : ''}
          {/* The clock, when the bank gave one. Two coffees on the same day
              at the same shop are otherwise indistinguishable in this list. */}
          {clock ? ` · ${clock}` : ''}
        </ThemedText>
      </View>
      <ThemedText type="small" tabular style={{ color: isIncome ? theme.income : theme.text }}>
        {arrived ? '+' : '−'}
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
