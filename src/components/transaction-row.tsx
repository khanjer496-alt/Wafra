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
import { transactionSource } from '@/lib/transaction-source';
import { transactionsWords } from '@/lib/transactions-copy';
import { isTransferCandidate, transferOwnership } from '@/lib/transfer-reconciliation';
import { transferReviewCopy } from '@/lib/transfer-review-copy';

export interface RowAccessibilityAction { name: string; label: string }

interface TransactionRowProps {
  transaction: Transaction;
  account?: Account;
  onPress?: (transaction: Transaction) => void;
  internal?: boolean;
  /** Merchant previews can keep their rows dedicated to transaction details. */
  merchantLinks?: boolean;
  /** The row's swipe actions, offered to screen readers on the main target. */
  accessibilityActions?: readonly RowAccessibilityAction[];
  onAccessibilityAction?: (name: string) => void;
}

/**
 * Two lines: the merchant with "time · source" under it, and the exact amount
 * with its category under it. Larger text stacks the amount; financial values
 * are never ellipsized. The merchant logo tile stays on every merchant row.
 */
function TransactionRowInner({ transaction, account, onPress, internal, merchantLinks = true,
  accessibilityActions, onAccessibilityAction }: TransactionRowProps) {
  const router = useRouter();
  const theme = useTheme();
  const language = useLanguage();
  const largeText = useLargeTextLayout();
  const words = transactionsWords(language);
  const meta = getCategory(transaction.category);
  const clock = clockTime(transaction);
  const ownership = transferOwnership(transaction);
  const ownTransfer = internal === true || ownership === 'own';
  const isTransfer = isLedgerTransfer(transaction) || internal === true;
  const pending = !internal && isTransferCandidate(transaction) && ownership === 'unknown';
  const isIncome = transaction.type === 'income' && !isTransfer && !pending;
  // Direction and classification differ: an inbound transfer is positive,
  // but never painted as income. Preserve the shipping accounting distinction.
  const arrived = transaction.type === 'income';
  // What a transfer means stays spelled out; the tag under the amount is short.
  const meaning = pending ? transferReviewCopy(language).ownershipUnknown
    : ownTransfer ? transferReviewCopy(language).confirmedOwn : null;
  const where = meaning ?? (isTransfer ? t('transferLabel', language)
    : transaction.paymentFlowSide === 'receipt' && transaction.category === 'other'
      ? t('registeredBillPayment', language)
      : categoryLabel(meta, language));
  const tag = isTransfer || pending ? words.transferTag : where;
  const source = words.source[transactionSource(transaction)];
  const meaningTestID = ownTransfer ? 'own-transfer-meaning' : pending ? 'pending-transfer-meaning' : undefined;
  const accountReview = isUnassignedIncome(transaction) || transaction.accountId === UNASSIGNED_TRANSACTION_ACCOUNT_ID
    ? t('incomeAccountReview', language) : null;
  const accountLabel = accountReview ?? account?.name;
  const accountShort = !accountReview && account?.last4 ? `••${account.last4}` : null;
  const detailLine = meaning ?? [clock, source, accountShort].filter(Boolean).join(' · ');
  const autoAdded = transaction.bestEffort ? t('autoAddedCheck', language) : null;
  const label = [transaction.title, autoAdded, where, accountLabel, clock, source,
    `${arrived ? t('plusWord', language) : t('minusWord', language)} ${formatAmount(transaction.amountFils, { decimals: false })} ${ledgerCurrencyCode()}`]
    .filter(Boolean).join(', ');
  const a11yActions = accessibilityActions && accessibilityActions.length > 0 && onAccessibilityAction
    ? { accessibilityActions: [...accessibilityActions],
      onAccessibilityAction: (event: { nativeEvent: { actionName: string } }) => onAccessibilityAction(event.nativeEvent.actionName) }
    : {};
  const amountText = <ThemedText type="smallBold" tabular style={[styles.amount, { color: isIncome ? theme.income : theme.text }]}>
    {arrived ? '+' : '−'}{formatAmount(transaction.amountFils, { decimals: false })}
  </ThemedText>;
  const secondary = <>
    <ThemedText testID={meaningTestID} type="meta" themeColor="textSecondary" style={styles.metadata}>{detailLine}</ThemedText>
    {accountReview ? <ThemedText type="meta" style={styles.metadata} themeColor="textSecondary">{accountReview}</ThemedText> : null}
    {autoAdded ? <ThemedText testID="best-effort-marker" type="meta" style={[styles.metadata, { color: theme.warning }]}>{autoAdded}</ThemedText> : null}
  </>;

  // Two sibling targets, not a link nested inside a button: the merchant
  // identity opens its summary; the exact amount keeps the original
  // transaction action. No ledger scan or store subscription belongs in a row.
  if (merchantLinks && onPress && transaction.title.trim() && !isTransfer && !pending) {
    const merchantWords = merchantSpendingCopy[language === 'ar' ? 'ar' : 'en'];
    const merchantLabel = isIncome ? merchantWords.incomeDetails : merchantWords.merchantDetails;
    return <View style={[styles.row, styles.splitRow, largeText && styles.splitRowLarge]} testID="merchant-transaction-row">
      <Pressable accessibilityRole="button" accessibilityLabel={[`${merchantLabel}: ${transaction.title}`, accountReview, autoAdded].filter(Boolean).join('. ')}
        testID="transaction-merchant-link"
        onPress={() => router.navigate(`/merchant?name=${encodeURIComponent(transaction.title.trim())}${isIncome ? '&type=income' : ''}`)}
        android_ripple={{ color: theme.backgroundSelected }}
        style={({ pressed }) => [styles.merchantTarget, largeText && styles.merchantTargetLarge,
          pressed && { backgroundColor: theme.backgroundSelected }]}>
        <MerchantAvatar title={transaction.title} category={transaction.category} size={36} />
        <View style={styles.content}>
          <ThemedText type="smallBold">{transaction.title}</ThemedText>
          {secondary}
        </View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={label} testID="transaction-details-link"
        onPress={() => onPress(transaction)} android_ripple={{ color: theme.backgroundSelected }}
        {...a11yActions}
        style={({ pressed }) => [styles.entryTarget, largeText && styles.entryTargetLarge,
          pressed && { backgroundColor: theme.backgroundSelected }]}>
        {amountText}
        <ThemedText type="meta" style={styles.metadata} themeColor="textSecondary">{tag}</ThemedText>
      </Pressable>
    </View>;
  }

  return <Pressable accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={label}
    onPress={onPress ? () => onPress(transaction) : undefined}
    android_ripple={{ color: theme.backgroundSelected }}
    {...(onPress ? a11yActions : {})}
    style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.backgroundSelected }]}>
    <MerchantAvatar title={transaction.title} category={transaction.category} size={36} />
    <View style={[styles.headline, largeText && styles.headlineLarge]}>
      <View style={[styles.content, styles.merchant, largeText && styles.merchantLarge]}>
        <ThemedText type="smallBold">{transaction.title}</ThemedText>
        {secondary}
      </View>
      <View style={[styles.amountColumn, largeText && styles.amountColumnLarge]}>
        {amountText}
        <ThemedText type="meta" style={styles.metadata} themeColor="textSecondary">{tag}</ThemedText>
      </View>
    </View>
  </Pressable>;
}

// Stable transaction/account references and the shared setEntry handler keep
// unchanged visible rows from rebuilding when import progress updates.
export const TransactionRow = React.memo(TransactionRowInner);
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, minHeight: 66, paddingVertical: 8 },
  content: { flex: 1, minWidth: 0, gap: 3 },
  headline: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  headlineLarge: { flexDirection: 'column', gap: 6 },
  merchant: { flexGrow: 1, flexShrink: 1, flexBasis: 120 },
  merchantLarge: { flexBasis: 'auto', flexGrow: 0, alignSelf: 'stretch' },
  amountColumn: { alignItems: 'flex-end', gap: 3, flexShrink: 1 },
  amountColumnLarge: { alignItems: 'flex-start' },
  amount: { flexShrink: 1 },
  metadata: { fontSize: 12, lineHeight: 17, flexShrink: 1 },
  splitRow: { flexWrap: 'wrap', alignItems: 'flex-start' },
  splitRowLarge: { flexDirection: 'column' },
  merchantTarget: { flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    flexGrow: 1, flexShrink: 1, flexBasis: 160, minWidth: 0, minHeight: 48 },
  merchantTargetLarge: { flexBasis: 'auto', flexGrow: 0, alignSelf: 'stretch' },
  entryTarget: { minHeight: 48, minWidth: 72, maxWidth: '100%', flexShrink: 1,
    alignItems: 'flex-end', justifyContent: 'center', paddingStart: 8, gap: 3 },
  entryTargetLarge: { alignSelf: 'flex-end' },
});
