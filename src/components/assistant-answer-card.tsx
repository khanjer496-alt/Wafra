import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { TransactionRow } from '@/components/transaction-row';
import { Icon } from '@/components/ui/icon';
import { Block } from '@/components/ui/layout';
import { Radius, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { assistantAnswerCopy } from '@/lib/assistant-answer';
import { formatAED, shortDate } from '@/lib/format';
import { t, tf } from '@/lib/i18n';
import type { AssistantQueryResult } from '@/lib/assistant-query';
import type { Account, Transaction } from '@/lib/types';

interface AssistantAnswerCardProps {
  result: AssistantQueryResult;
  transactions: readonly Transaction[];
  accounts: readonly Account[];
  usedFallback: boolean;
  onOpenTransaction: (id: string) => void;
  onOpenBills: () => void;
}

export const AssistantAnswerCard = ({
  result,
  transactions,
  accounts,
  usedFallback,
  onOpenTransaction,
  onOpenBills,
}: AssistantAnswerCardProps) => {
  const theme = useTheme();
  const language = useLanguage();
  const copy = assistantAnswerCopy(result, language);
  const byId = new Map(transactions.map((row) => [row.id, row] as const));
  const accountById = new Map(accounts.map((row) => [row.id, row] as const));

  return (
    <Block style={styles.card}>
      <View style={styles.answerHeader}>
        <View style={[styles.spark, { backgroundColor: theme.primarySoft }]}>
          <Icon name="spark" size={17} color={theme.primary} />
        </View>
        <ThemedText type="micro" themeColor="textSecondary">
          {t('assistantAnswerLabel', language)}
        </ThemedText>
      </View>
      <ThemedText type="subtitle">{copy.title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{copy.body}</ThemedText>
      {usedFallback ? (
        <ThemedText type="meta" themeColor="textTertiary">
          {t('assistantFallbackNote', language)}
        </ThemedText>
      ) : null}

      {result.transactions.length > 0 ? (
        <View style={styles.sources}>
          <ThemedText type="micro" themeColor="textSecondary">
            {t('assistantSources', language)}
          </ThemedText>
          {result.transactions.map((evidence, index) => {
            const transaction = byId.get(evidence.id);
            if (!transaction) return null;
            return (
              <View
                key={transaction.id}
                style={index > 0 ? [styles.divider, { borderTopColor: theme.cardBorder }] : undefined}>
                <TransactionRow
                  transaction={transaction}
                  account={accountById.get(transaction.accountId)}
                  internal={evidence.transfer}
                  onPress={() => onOpenTransaction(transaction.id)}
                />
              </View>
            );
          })}
        </View>
      ) : null}

      {result.bills.length > 0 ? (
        <View style={styles.sources}>
          {result.bills.map((bill, index) => (
            <Pressable
              key={bill.id}
              accessibilityRole="button"
              accessibilityLabel={`${bill.title}, ${formatAED(bill.amountFils)}, ${bill.status}`}
              onPress={onOpenBills}
              style={[
                styles.evidenceRow,
                index > 0 && styles.divider,
                index > 0 && { borderTopColor: theme.cardBorder },
              ]}>
              <View style={styles.evidenceText}>
                <ThemedText type="small">{bill.title}</ThemedText>
                <ThemedText type="meta" themeColor="textTertiary">
                  {bill.status === 'paid'
                    ? t('assistantPaid', language)
                    : tf('assistantDue', { date: shortDate(bill.dueISO) }, language)}
                </ThemedText>
              </View>
              <ThemedText type="small" tabular>{formatAED(bill.amountFils)}</ThemedText>
            </Pressable>
          ))}
        </View>
      ) : null}

      {result.recurring.length > 0 ? (
        <View style={styles.sources}>
          {result.recurring.map((row, index) => (
            <Pressable
              key={`${row.title}-${row.nextExpectedISO}`}
              accessibilityRole="button"
              accessibilityLabel={`${row.title}, ${formatAED(row.amountFils)}, ${row.cadence}`}
              onPress={onOpenBills}
              style={[
                styles.evidenceRow,
                index > 0 && styles.divider,
                index > 0 && { borderTopColor: theme.cardBorder },
              ]}>
              <View style={styles.evidenceText}>
                <ThemedText type="small">{row.title}</ThemedText>
                <ThemedText type="meta" themeColor="textTertiary">
                  {row.cadence} · {shortDate(row.nextExpectedISO)}
                </ThemedText>
              </View>
              <ThemedText type="small" tabular>{formatAED(row.amountFils)}</ThemedText>
            </Pressable>
          ))}
        </View>
      ) : null}
    </Block>
  );
};

const styles = StyleSheet.create({
  card: { gap: Spacing.two + 4, borderRadius: Radius.sheet },
  answerHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  spark: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  sources: { marginTop: Spacing.one, gap: 0 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth },
  evidenceRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  evidenceText: { flex: 1, gap: 2 },
});
