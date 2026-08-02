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
import { cardStatementView } from '@/lib/cards';
import { shortDate } from '@/lib/format';
import { useStore } from '@/lib/store';
import type { Account } from '@/lib/types';
import { t, tf } from '@/lib/i18n';

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

  // Every rule about what a card owes lives in cards.ts, next to `openDues`
  // and `allocatePayments` — and, unlike a .tsx, under test. This sheet got
  // each of those rules wrong at some point precisely because it held its own
  // copy of them.
  const data = useMemo(
    () => (account ? cardStatementView(state, account.id) : null),
    [account, state],
  );

  if (!account || !data) return null;

  const settledShare =
    data.billedFils > 0
      ? Math.min(1, (data.billedFils - data.outstandingFils) / data.billedFils)
      : 0;

  return (
    <BottomSheet visible onClose={onClose} title={t('cardDetail')}>
      <View style={styles.head}>
        <AccountTile account={account} size={46} />
        <View style={styles.headText}>
          <ThemedText type="subtitle" numberOfLines={1}>
            {account.bankName ?? account.name}
          </ThemedText>
          <ThemedText type="meta" themeColor="textTertiary">
            {account.cardType === 'credit' ? t('credit') : t('debit')}
            {account.last4 ? ` ·· ${account.last4}` : ''}
          </ThemedText>
        </View>
      </View>

      {/* The one figure the user opened this for, before any list. */}
      {data.open.length > 0 && (
        <View style={styles.summary}>
          <View style={styles.summaryRow}>
            <ThemedText type="micro" themeColor="textTertiary">
              {t('stillOwed')}
            </ThemedText>
            <ThemedText type="nano" themeColor="textTertiary">
              {tf('openStatements', {
                count: data.open.length,
                s: data.open.length === 1 ? '' : 's',
              })}
            </ThemedText>
          </View>
          <Money
            fils={data.outstandingFils}
            type="sheetAmount"
            prefix={false}
            color={theme.expense}
          />
          {/* Progress is only honest once something has been paid; a
              full-width empty track reads as a bug. */}
          {settledShare > 0 && <ProgressBar ratio={settledShare} color={theme.income} height={5} />}
        </View>
      )}

      <View>
        <SectionHeader title={t('statements')} />
        {data.statements.length === 0 ? (
          <ThemedText type="default" themeColor="textSecondary">
            {t('noStatementYet')}
          </ThemedText>
        ) : (
          data.statements.map((d, i) => {
            const paid = data.paidByDueId.get(d.id) ?? 0;
            const settled = !!d.settledAt || paid >= d.totalDueFils;
            return (
              <Row key={d.id} last={i === data.statements.length - 1}>
                <View
                  style={[styles.dot, { backgroundColor: settled ? theme.income : theme.expense }]}
                />
                <View style={styles.rowText}>
                  <ThemedText type="small">
                    {tf('dueDate', { date: shortDate(d.dueDate) })}
                  </ThemedText>
                  <ThemedText type="meta" themeColor="textTertiary" tabular>
                    {settled
                      ? t('settled')
                      : tf('percentPaid', {
                          percent: Math.round((paid / d.totalDueFils) * 100),
                        })}
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
          title={t('paymentsMade')}
          trailing={<Money fils={data.paidTotalFils} prefix={false} type="nano" />}
        />
        {data.payments.length === 0 ? (
          <ThemedText type="default" themeColor="textSecondary">
            {t('noCardPaymentYet')}
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
