import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useTheme } from '@/hooks/use-theme';
import { categoryLabel, getCategory } from '@/lib/categories';
import { clockTime, formatAmount } from '@/lib/format';
import { ledgerCurrencyCode } from '@/lib/markets';
import type { Account, Transaction } from '@/lib/types';
import { t } from '@/lib/i18n';

interface TransactionRowProps {
  transaction: Transaction;
  account?: Account;
  onPress?: (transaction: Transaction) => void;
  internal?: boolean;
}

/**
 * Merchant and exact amount share the first line. Category/time and account
 * identity have their own hierarchy rather than one long metadata sentence.
 * Larger text stacks the amount; financial values are never ellipsized.
 */
function TransactionRowInner({ transaction, account, onPress, internal }: TransactionRowProps) {
  const theme = useTheme();
  const language = useLanguage();
  const largeText = useLargeTextLayout();
  const meta = getCategory(transaction.category);
  const clock = clockTime(transaction);
  const isTransfer = transaction.isTransfer || internal === true;
  const isIncome = transaction.type === 'income' && !isTransfer;
  // Direction and classification differ: an inbound transfer is positive,
  // but never painted as income. Preserve the shipping accounting distinction.
  const arrived = transaction.type === 'income';
  const where = isTransfer ? t('transferLabel', language) : categoryLabel(meta, language);
  const label = [transaction.title, where, account?.name, clock,
    `${arrived ? t('plusWord', language) : t('minusWord', language)} ${formatAmount(transaction.amountFils, { decimals: false })} ${ledgerCurrencyCode()}`]
    .filter(Boolean).join(', ');

  return <Pressable accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={label}
    onPress={onPress ? () => onPress(transaction) : undefined}
    android_ripple={{ color: theme.backgroundSelected }}
    style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.backgroundSelected }]}>
    <MerchantAvatar title={transaction.title} category={transaction.category} size={40} />
    <View style={styles.content}>
      <View style={[styles.headline, largeText && styles.headlineLarge]}>
        <ThemedText type="smallBold" style={[styles.merchant, largeText && styles.merchantLarge]}>{transaction.title}</ThemedText>
        <ThemedText type="smallBold" tabular style={[styles.amount, { color: isIncome ? theme.income : theme.text }]}>
          {arrived ? '+' : '−'}{formatAmount(transaction.amountFils, { decimals: false })}
        </ThemedText>
      </View>
      <View style={styles.details}>
        <ThemedText type="meta" themeColor="textSecondary" style={styles.category}>{where}</ThemedText>
        {clock ? <ThemedText type="meta" themeColor="textTertiary" tabular>{clock}</ThemedText> : null}
      </View>
      {account ? <ThemedText type="meta" themeColor="textTertiary">{account.name}</ThemedText> : null}
    </View>
  </Pressable>;
}

// Stable transaction/account references and the shared setEntry handler keep
// unchanged visible rows from rebuilding when import progress updates.
export const TransactionRow = React.memo(TransactionRowInner);
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, minHeight: 76, paddingVertical: 14 },
  content: { flex: 1, minWidth: 0, gap: 4 },
  headline: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  headlineLarge: { flexDirection: 'column', gap: 6 },
  merchant: { flexGrow: 1, flexShrink: 1, flexBasis: 120 },
  merchantLarge: { flexBasis: 'auto', flexGrow: 0, alignSelf: 'stretch' },
  amount: { flexShrink: 1 },
  details: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  category: { flexShrink: 1 },
});
