import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { CardPaymentSheet } from '@/components/card-payment-sheet';
import { ThemedText } from '@/components/themed-text';
import { BandFigure } from '@/components/ui/band/band-figure';
import { EButton } from '@/components/ui/band/e-button';
import { StatusBar } from '@/components/ui/band/status-bar';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { ProgressBar } from '@/components/ui/charts';
import { Money } from '@/components/ui/money';
import { AccountTile } from '@/components/ui/tile';
import { Spacing } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
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
  // Accounts' slate for the sheet's controls, and the ink card (a piece of
  // the Home band, dark in both schemes) for the statement itself.
  const band = useBand('accounts');
  const ink = useBand('home');
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
  // On the ink card for a credit card with a bill; on the sheet otherwise.
  const onInk = data.billable;
  const identity = (
    <View style={styles.identity} testID="card-identity">
      <AccountTile account={account} size={40} />
      <View style={styles.identityText}>
        <ThemedText type="smallBold" accessibilityRole="header" style={{ color: onInk ? ink.onBand : band.text }}>
          {account.bankName ?? account.name}
        </ThemedText>
        <ThemedText type="meta" style={{ color: onInk ? ink.onBandSecondary : band.textSecondary }}>
          {account.cardType === 'credit' ? t('credit') : t('debit')}
          {account.last4 ? ` ·· ${account.last4}` : ''}
        </ThemedText>
      </View>
    </View>
  );

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
          {identity}
          <ThemedText type="default" themeColor="textSecondary">
            {t('debitHasNoStatement')}
          </ThemedText>
        </>
      )}

      {data.billable && (
        <>
          {/* The one figure the user opened this for, on the card itself. */}
          <View style={[styles.inkCard, { backgroundColor: ink.band, borderColor: ink.bandRule }]} testID="card-ink">
            {identity}
            {statement
              ? <BandFigure testID="card-statement-hero" label={w.statementBalance} fils={data.outstandingFils} decimals
                  palette={ink} size="large" fitInset={40} />
              : null}
          </View>
          {statement && (
            <View style={styles.summary}>
              {/* Progress is only honest once something has been paid; a
                  full-width empty track reads as a bug. */}
              {settledShare > 0 && (
                <>
                  <ProgressBar ratio={settledShare} color={band.statusOk} height={5} />
                  <ThemedText type="meta" themeColor="textSecondary">
                    {w.leftOfStatement(formatAED(data.outstandingFils), formatAED(data.billedFils))}
                  </ThemedText>
                </>
              )}
              <ThemedText type="small" testID="card-statement-due">
                {w.dueOn(shortDate(statement.dueDate))}
                {statedMinimum !== null ? ` · ${w.minimum(formatAED(statedMinimum))}` : ''}
              </ThemedText>
              {usage && (
                <View style={styles.usage} testID="card-usage">
                  <StatusBar spentMinor={usage.usedFils} limitMinor={usage.limitFils} palette={band} />
                  <ThemedText type="meta" themeColor="textSecondary">
                    {w.usedOfLimit(formatAED(usage.usedFils, { decimals: false }), formatAED(usage.limitFils, { decimals: false }))}
                  </ThemedText>
                </View>
              )}
              <EButton palette={band} label={w.recordPayment} onPress={() => setPaying(statement)} testID="card-record-payment" />
              <ThemedText type="meta" themeColor="textSecondary">
                {w.cardReminder(shortDate(statement.dueDate))}
              </ThemedText>
            </View>
          )}

          <View style={styles.section}>
            <ThemedText type="heading" accessibilityRole="header">{t('statements')}</ThemedText>
            {data.statements.length === 0 ? (
              <ThemedText type="default" themeColor="textSecondary">
                {t('noStatementYet')}
              </ThemedText>
            ) : (
              data.statements.map((d, i) => {
                const paid = data.paidByDueId.get(d.id) ?? 0;
                const settled = paid >= d.totalDueFils;
                return (
                  <View key={d.id} style={[styles.listRow,
                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: band.rule }]}>
                    <View style={styles.rowText}>
                      <ThemedText type="smallBold">
                        {tf('dueDate', { date: shortDate(d.dueDate) })}
                      </ThemedText>
                      <ThemedText type="meta" tabular style={{ color: settled ? band.statusOk : band.textSecondary }}>
                        {settled
                          ? t('settled')
                          : tf('percentPaid', {
                              percent: Math.round((paid / d.totalDueFils) * 100),
                            })}
                      </ThemedText>
                    </View>
                    <Money fils={d.totalDueFils} type="smallBold" />
                  </View>
                );
              })
            )}
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <ThemedText type="heading" accessibilityRole="header" style={styles.rowText}>{t('paymentsMade')}</ThemedText>
              <Money fils={data.paidTotalFils} type="small" color={band.textSecondary} />
            </View>
            {data.payments.length === 0 ? (
              <ThemedText type="default" themeColor="textSecondary">
                {t('noCardPaymentYet')}
              </ThemedText>
            ) : (
              data.payments.slice(0, 24).map((p, i) => (
                <View key={p.id} style={[styles.listRow,
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: band.rule }]}>
                  <ThemedText type="small" style={styles.rowText}>
                    {shortDate(p.date)}
                  </ThemedText>
                  <Money fils={p.amountFils} type="smallBold" color={band.statusOk} />
                </View>
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
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  identityText: { flex: 1, minWidth: 0, gap: Spacing.half },
  inkCard: { borderRadius: 22, padding: 16, gap: 18, borderWidth: StyleSheet.hairlineWidth },
  summary: { gap: Spacing.two + 2 },
  usage: { gap: Spacing.one },
  section: { gap: 2, paddingTop: Spacing.two },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: Spacing.two },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 10 },
  rowText: { flex: 1, minWidth: 0, gap: Spacing.half },
});
