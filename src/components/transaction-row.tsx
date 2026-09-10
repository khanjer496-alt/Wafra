import React from 'react';
import { useRouter } from 'expo-router';
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
import { merchantSpendingCopy } from '@/lib/merchant-spending-copy';
import { isTransfer as isLedgerTransfer, isUnassignedIncome, UNASSIGNED_TRANSACTION_ACCOUNT_ID } from '@/lib/ledger';
import { isTransferCandidate, transferOwnership } from '@/lib/transfer-reconciliation';
import { transferReviewCopy } from '@/lib/transfer-review-copy';

interface TransactionRowProps {
  transaction: Transaction;
  account?: Account;
  onPress?: (transaction: Transaction) => void;
  internal?: boolean;
  /** Merchant previews can keep their rows dedicated to transaction details. */
  merchantLinks?: boolean;
}

/**
 * Merchant and exact amount share the first line. Category/time and account
 * identity have their own hierarchy rather than one long metadata sentence.
 * Larger text stacks the amount; financial values are never ellipsized.
 */
function TransactionRowInner({ transaction, account, onPress, internal, merchantLinks = true }: TransactionRowProps) {
  const router = useRouter();
  const theme = useTheme();
  const language = useLanguage();
  const largeText = useLargeTextLayout();
  const meta = getCategory(transaction.category);
  const clock = clockTime(transaction);
  const isTransfer = isLedgerTransfer(transaction) || internal === true;
  const pending = !internal && isTransferCandidate(transaction) && transferOwnership(transaction) === 'unknown';
  const isIncome = transaction.type === 'income' && !isTransfer && !pending;
  // Direction and classification differ: an inbound transfer is positive,
  // but never painted as income. Preserve the shipping accounting distinction.
  const arrived = transaction.type === 'income';
  const where = pending ? transferReviewCopy(language).ownershipUnknown
    : isTransfer ? t('transferLabel', language)
      : transaction.paymentFlowSide === 'receipt' && transaction.category === 'other'
        ? t('registeredBillPayment', language)
        : categoryLabel(meta, language);
  const accountReview = isUnassignedIncome(transaction) || transaction.accountId === UNASSIGNED_TRANSACTION_ACCOUNT_ID
    ? t('incomeAccountReview', language) : null;
  const accountLabel = accountReview ?? account?.name;
  const bankCaption = account?.bankName || account?.name;
  const accountCaption = accountReview ?? (bankCaption
    ? `${bankCaption}${account?.last4 && !bankCaption.includes(account.last4) ? ` ·${account.last4}` : ''}`
    : undefined);
  const label = [transaction.title, where, accountLabel, clock,
    `${arrived ? t('plusWord', language) : t('minusWord', language)} ${formatAmount(transaction.amountFils, { decimals: false })} ${ledgerCurrencyCode()}`]
    .filter(Boolean).join(', ');

  // Two sibling targets, not a link nested inside a button: the merchant
  // identity opens its summary; the exact amount and Details keep the original
  // transaction action. No ledger scan or store subscription belongs in a row.
  if (merchantLinks && onPress && transaction.title.trim() && !isTransfer && !pending) {
    const merchantWords = merchantSpendingCopy[language === 'ar' ? 'ar' : 'en'];
    const merchantLabel = isIncome ? merchantWords.incomeDetails : merchantWords.merchantDetails;
    return <View style={[styles.row, styles.splitRow, largeText && styles.splitRowLarge]} testID="merchant-transaction-row">
      <Pressable accessibilityRole="button" accessibilityLabel={[`${merchantLabel}: ${transaction.title}`, accountReview].filter(Boolean).join('. ')}
        testID="transaction-merchant-link"
        onPress={() => router.navigate(`/merchant?name=${encodeURIComponent(transaction.title.trim())}${isIncome ? '&type=income' : ''}`)}
        android_ripple={{ color: theme.backgroundSelected }}
        style={({ pressed }) => [styles.merchantTarget, largeText && styles.merchantTargetLarge,
          pressed && { backgroundColor: theme.backgroundSelected }]}>
        <MerchantAvatar title={transaction.title} category={transaction.category} size={36} />
        <View style={styles.content}>
          <ThemedText type="smallBold">{transaction.title}</ThemedText>
          <ThemedText type="meta" themeColor="textSecondary" style={styles.metadata}>{[where, clock].filter(Boolean).join(' · ')}</ThemedText>
          {accountCaption ? <ThemedText type="meta" style={styles.metadata} themeColor={accountReview ? 'textSecondary' : 'textTertiary'}>{accountCaption}</ThemedText> : null}
        </View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={label} testID="transaction-details-link"
        onPress={() => onPress(transaction)} android_ripple={{ color: theme.backgroundSelected }}
        style={({ pressed }) => [styles.entryTarget, largeText && styles.entryTargetLarge,
          pressed && { backgroundColor: theme.backgroundSelected }]}>
        <ThemedText type="smallBold" tabular style={[styles.amount, { color: isIncome ? theme.income : theme.text }]}>
          {arrived ? '+' : '−'}{formatAmount(transaction.amountFils, { decimals: false })}
        </ThemedText>
        <ThemedText type="meta" style={styles.metadata} themeColor="textTertiary">{merchantWords.entryDetails}</ThemedText>
      </Pressable>
    </View>;
  }

  return <Pressable accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={label}
    onPress={onPress ? () => onPress(transaction) : undefined}
    android_ripple={{ color: theme.backgroundSelected }}
    style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.backgroundSelected }]}>
    <MerchantAvatar title={transaction.title} category={transaction.category} size={36} />
    <View style={styles.content}>
      <View style={[styles.headline, largeText && styles.headlineLarge]}>
        <ThemedText type="smallBold" style={[styles.merchant, largeText && styles.merchantLarge]}>{transaction.title}</ThemedText>
        <ThemedText type="smallBold" tabular style={[styles.amount, { color: isIncome ? theme.income : theme.text }]}>
          {arrived ? '+' : '−'}{formatAmount(transaction.amountFils, { decimals: false })}
        </ThemedText>
      </View>
      <ThemedText type="meta" themeColor="textSecondary" style={styles.metadata}>{[where, clock].filter(Boolean).join(' · ')}</ThemedText>
      {accountCaption ? <ThemedText type="meta" style={styles.metadata} themeColor={accountReview ? 'textSecondary' : 'textTertiary'}>{accountCaption}</ThemedText> : null}
    </View>
  </Pressable>;
}

// Stable transaction/account references and the shared setEntry handler keep
// unchanged visible rows from rebuilding when import progress updates.
export const TransactionRow = React.memo(TransactionRowInner);
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, minHeight: 72, paddingVertical: 10 },
  content: { flex: 1, minWidth: 0, gap: 3 },
  headline: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  headlineLarge: { flexDirection: 'column', gap: 6 },
  merchant: { flexGrow: 1, flexShrink: 1, flexBasis: 120 },
  merchantLarge: { flexBasis: 'auto', flexGrow: 0, alignSelf: 'stretch' },
  amount: { flexShrink: 1 },
  metadata: { fontSize: 12, lineHeight: 19, flexShrink: 1 },
  splitRow: { flexWrap: 'wrap', alignItems: 'flex-start' },
  splitRowLarge: { flexDirection: 'column' },
  merchantTarget: { flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    flexGrow: 1, flexShrink: 1, flexBasis: 160, minWidth: 0, minHeight: 48 },
  merchantTargetLarge: { flexBasis: 'auto', flexGrow: 0, alignSelf: 'stretch' },
  entryTarget: { minHeight: 48, minWidth: 72, maxWidth: '100%', flexShrink: 1,
    alignItems: 'flex-end', justifyContent: 'center', paddingStart: 8, gap: 4 },
  entryTargetLarge: { alignSelf: 'flex-end' },
});
