import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { CardPaymentSheet } from '@/components/card-payment-sheet';
import { ThemedText } from '@/components/themed-text';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { ProgressBar } from '@/components/ui/charts';
import { Button } from '@/components/ui/controls';
import { Row, SectionHeader } from '@/components/ui/layout';
import { Money } from '@/components/ui/money';
import { AccountTile } from '@/components/ui/tile';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { cardStatementView } from '@/lib/cards';
import { formatAED, shortDate } from '@/lib/format';
import { cardUsage } from '@/lib/money-places';
import { moneyPlacesWords } from '@/lib/money-places-copy';
import { useStore } from '@/lib/store';
import type { Account, CardDue } from '@/lib/types';
import { t, tf } from '@/lib/i18n';

interface CardDetailSheetProps {
  /** The card to show, or null to keep the sheet closed. */
  account: Account | null;
  onClose: () => void;
  footer?: React.ReactNode;
}

/**
 * Statements and payment history for one card.
 *
 * Shared rather than owned by the Cards screen: a due is a question about one
 * card, not a reason to change screens.
 */
export function CardDetailSheet({ account, onClose, footer }: CardDetailSheetProps) {
  const theme = useTheme();
  const w = moneyPlacesWords(useLanguage());
  const { state } = useStore();
  // "Record a payment" opens the payment sheet on top of this one.
  const [paying, setPaying] = useState<CardDue | null>(null);
  useEffect(() => {
    setPaying(null);
  }, [account]);

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
  const statement = data.open[0] ?? null;
  // Only a limit the user entered, against a bank-quoted figure (money-places.ts).
  const usage = cardUsage(account);
  // "Min" is the bank's figure or nothing; an estimate is never shown as one.
  const statedMinimum = statement && !statement.minDueEstimated && statement.minDueFils > 0
    ? statement.minDueFils
    : null;

  return (
    <BottomSheet visible onClose={onClose} title={t('cardDetail')} footer={footer}>
      {/*
        Both lists below are about a BILL, and a debit card does not have one.
        Drawn unconditionally, this sheet told a user their Liv debit card had
        "Payments made 360,054" — their salary and deposits — under a
        Statements section reading "no statement message has arrived for this
        card yet", which promises one is coming when none ever can. `billable`
        is asked of the whole card group, so opening the debit sibling of a
        real credit card still shows that card's bill.
      */}
      {!data.billable && (
        <>
          <View style={styles.head}>
            <AccountTile account={account} size={46} />
            <View style={styles.headText}>
              <ThemedText type="subtitle">
                {account.bankName ?? account.name}
              </ThemedText>
              <ThemedText type="meta" themeColor="textTertiary">
                {account.cardType === 'credit' ? t('credit') : t('debit')}
                {account.last4 ? ` ·· ${account.last4}` : ''}
              </ThemedText>
            </View>
          </View>
          <ThemedText type="default" themeColor="textSecondary">
            {t('debitHasNoStatement')}
          </ThemedText>
        </>
      )}

      {data.billable && (
        <>
          {/* The one figure the user opened this for, before any list. */}
          {statement && (
            <View style={styles.summary} testID="card-statement-hero">
              <ThemedText type="small" themeColor="textSecondary">
                {w.statementBalance}
              </ThemedText>
              <Money fils={data.outstandingFils} type="sheetAmount" />
              {/* Progress is only honest once something has been paid; a
                  full-width empty track reads as a bug. */}
              {settledShare > 0 && (
                <>
                  <ProgressBar ratio={settledShare} color={theme.income} height={5} />
                  <ThemedText type="meta" themeColor="textSecondary">
                    {w.leftOfStatement(formatAED(data.outstandingFils), formatAED(data.billedFils))}
                  </ThemedText>
                </>
              )}
              <ThemedText type="meta" themeColor="textSecondary" testID="card-statement-due">
                {w.dueOn(shortDate(statement.dueDate))}
                {statedMinimum !== null ? ` · ${w.minimum(formatAED(statedMinimum))}` : ''}
              </ThemedText>
              {usage && (
                <View style={styles.usage} testID="card-usage">
                  <ProgressBar ratio={usage.ratio} color={theme.primary} height={5} />
                  <ThemedText type="meta" themeColor="textSecondary">
                    {w.usedOfLimit(formatAED(usage.usedFils, { decimals: false }), formatAED(usage.limitFils, { decimals: false }))}
                  </ThemedText>
                </View>
              )}
              <Button label={w.recordPayment} icon="check" onPress={() => setPaying(statement)} />
              <ThemedText type="meta" themeColor="textTertiary">
                {w.cardReminder(shortDate(statement.dueDate))}
              </ThemedText>
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
                const settled = paid >= d.totalDueFils;
                return (
                  <Row key={d.id} last={i === data.statements.length - 1}>
                    <View
                      style={[
                        styles.dot,
                        { backgroundColor: settled ? theme.income : theme.expense },
                      ]}
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

          <View style={styles.head}>
            <AccountTile account={account} size={46} />
            <View style={styles.headText}>
              <ThemedText type="subtitle">
                {account.bankName ?? account.name}
              </ThemedText>
              <ThemedText type="meta" themeColor="textTertiary">
                {account.cardType === 'credit' ? t('credit') : t('debit')}
                {account.last4 ? ` ·· ${account.last4}` : ''}
              </ThemedText>
            </View>
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
        </>
      )}
      {/* Nested so the payment sheet stacks over this one on every platform. */}
      <CardPaymentSheet due={paying} onClose={() => setPaying(null)} />
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
  usage: {
    gap: Spacing.one,
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
