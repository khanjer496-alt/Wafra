import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { ProgressBar } from '@/components/ui/charts';
import { Row, SectionHeader } from '@/components/ui/layout';
import { Money } from '@/components/ui/money';
import { AccountTile } from '@/components/ui/tile';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { duePaidFils } from '@/lib/cards';
import { shortDate } from '@/lib/format';
import { useStore } from '@/lib/store';
import type { Account } from '@/lib/types';

interface CardDetailSheetProps {
  /** The card to show, or null to keep the sheet closed. */
  account: Account | null;
  onClose: () => void;
}

/**
 * Statements and payment history for one card.
 *
 * Shared rather than owned by the Cards screen: a due is a question about one
 * card, not a reason to change screens.
 */
export function CardDetailSheet({ account, onClose }: CardDetailSheetProps) {
  const theme = useTheme();
  const { state } = useStore();

  const data = useMemo(() => {
    if (!account) return null;
    const statements = state.cardDues
      .filter((d) => d.accountId === account.id)
      .slice()
      .sort((a, b) => b.dueDate.localeCompare(a.dueDate));
    // Every transfer on a credit card is a payment INTO it — you cannot spend
    // out of a card by transfer.
    const payments = state.transactions
      .filter((t) => t.accountId === account.id && t.isTransfer)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    const paidTotal = payments.reduce((s, t) => s + t.amountFils, 0);
    // A payment that arrived by SMS is a transfer on the card, not a write to
    // paidFils — that field only moves for a manual "Mark paid". Reading it
    // raw showed a statement the bank had already confirmed paid as "0% paid"
    // and kept its full balance in "Still owed". duePaidFils is the figure
    // that accounts for both, and it is what every other screen uses.
    const paidOf = new Map(statements.map((d) => [d.id, duePaidFils(state, d)] as const));
    const open = statements.filter(
      (d) => !d.settledAt && (paidOf.get(d.id) ?? 0) < d.totalDueFils,
    );
    const outstanding = open.reduce(
      (s, d) => s + Math.max(0, d.totalDueFils - (paidOf.get(d.id) ?? 0)),
      0,
    );
    const billed = open.reduce((s, d) => s + d.totalDueFils, 0);
    return { statements, payments, paidTotal, outstanding, billed, paidOf, openCount: open.length };
  }, [account, state]);

  if (!account || !data) return null;

  const settledShare = data.billed > 0 ? Math.min(1, (data.billed - data.outstanding) / data.billed) : 0;

  return (
    <BottomSheet visible onClose={onClose} title="Card detail">
      <View style={styles.head}>
        <AccountTile account={account} size={46} />
        <View style={styles.headText}>
          <ThemedText type="subtitle" numberOfLines={1}>
            {account.bankName ?? account.name}
          </ThemedText>
          <ThemedText type="meta" themeColor="textTertiary">
            {account.cardType === 'credit' ? 'Credit' : 'Debit'}
            {account.last4 ? ` ·· ${account.last4}` : ''}
          </ThemedText>
        </View>
      </View>

      {/* The one figure the user opened this for, before any list. */}
      {data.openCount > 0 && (
        <View style={styles.summary}>
          <View style={styles.summaryRow}>
            <ThemedText type="micro" themeColor="textTertiary">
              Still owed
            </ThemedText>
            <ThemedText type="nano" themeColor="textTertiary">
              {data.openCount} open statement{data.openCount === 1 ? '' : 's'}
            </ThemedText>
          </View>
          <Money fils={data.outstanding} type="sheetAmount" prefix={false} color={theme.expense} />
          {/* Progress is only honest once something has been paid; a
              full-width empty track reads as a bug. */}
          {settledShare > 0 && <ProgressBar ratio={settledShare} color={theme.income} height={5} />}
        </View>
      )}

      <View>
        <SectionHeader title="Statements" />
        {data.statements.length === 0 ? (
          <ThemedText type="default" themeColor="textSecondary">
            No statement message has arrived for this card yet.
          </ThemedText>
        ) : (
          data.statements.map((d, i) => {
            const paid = data.paidOf.get(d.id) ?? 0;
            const settled = !!d.settledAt || paid >= d.totalDueFils;
            return (
              <Row key={d.id} last={i === data.statements.length - 1}>
                <View
                  style={[styles.dot, { backgroundColor: settled ? theme.income : theme.expense }]}
                />
                <View style={styles.rowText}>
                  <ThemedText type="small">Due {shortDate(d.dueDate)}</ThemedText>
                  <ThemedText type="meta" themeColor="textTertiary" tabular>
                    {settled ? 'Settled' : `${Math.round((paid / d.totalDueFils) * 100)}% paid`}
                  </ThemedText>
                </View>
                <Money fils={d.totalDueFils} prefix={false} />
              </Row>
            );
          })
        )}
      </View>

      <View>
        <SectionHeader
          title="Payments made"
          trailing={<Money fils={data.paidTotal} prefix={false} type="nano" />}
        />
        {data.payments.length === 0 ? (
          <ThemedText type="default" themeColor="textSecondary">
            No payment to this card has been detected yet.
          </ThemedText>
        ) : (
          data.payments.slice(0, 24).map((p, i) => (
            <Row key={p.id} last={i === Math.min(data.payments.length, 24) - 1}>
              <View style={[styles.dot, { backgroundColor: theme.income }]} />
              <ThemedText type="small" style={styles.rowText}>
                {shortDate(p.date)}
              </ThemedText>
              <Money fils={p.amountFils} prefix={false} color={theme.income} />
            </Row>
          ))
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three - 2,
  },
  headText: {
    flex: 1,
    gap: Spacing.half,
  },
  summary: {
    gap: Spacing.two + 2,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
  },
});
