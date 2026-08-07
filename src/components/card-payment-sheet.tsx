import React, { useMemo } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/controls';
import { LabelTable } from '@/components/ui/layout';
import { Money } from '@/components/ui/money';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { dueWithStatus, duePaidFils } from '@/lib/cards';
import { formatAmount, monthKey, shortDate, toISODate } from '@/lib/format';
import { requestNotificationPermission, syncPaymentReminders } from '@/lib/notifications';
import { useStore } from '@/lib/store';
import type { CardDue } from '@/lib/types';
import { t, tf } from '@/lib/i18n';

interface CardPaymentSheetProps {
  /** The statement to settle, or null to keep the sheet closed. */
  due: CardDue | null;
  onClose: () => void;
}

/**
 * One credit-card statement.
 *
 * The dark block is the only solid dark surface in light mode, because a card
 * is a physical object and this is the face of it. Everything on it comes from
 * the data model: there is no credit limit and no APR in it, so there is no
 * utilisation ring and no interest projection here either.
 */
export function CardPaymentSheet({ due, onClose }: CardPaymentSheetProps) {
  const theme = useTheme();
  const { state, payCardDue } = useStore();
  const now = useMemo(() => new Date(), []);
  const todayISO = toISODate(now);

  const data = useMemo(() => {
    if (!due) return null;
    const status = dueWithStatus(state, due, now);
    const paid = duePaidFils(state, due);
    const account = state.accounts.find((a) => a.id === due.accountId);

    // What this card has been charged in the current month, which is the
    // figure the next statement is being built from.
    const key = monthKey(now);
    let monthFils = 0;
    let charges = 0;
    for (const t of state.transactions) {
      if (t.accountId !== due.accountId || t.isTransfer || t.type !== 'expense') continue;
      if (monthKey(t.date) !== key) continue;
      monthFils += t.amountFils;
      charges += 1;
    }

    const payments = state.transactions.filter(
      (t) => t.accountId === due.accountId && t.isTransfer && t.type === 'income',
    ).length;

    return { status, paid, account, monthFils, charges, payments };
  }, [due, state, now]);

  if (!due || !data) return null;

  const { status, paid, account, monthFils, charges, payments } = data;
  const paidShare = due.totalDueFils > 0 ? paid / due.totalDueFils : 0;

  const markPaid = () => {
    const name = account?.name ?? 'Card';
    Alert.alert(
      t('markStatementPaid'),
      tf('fileCardPaymentBody', {
        amount: formatAmount(status.remainingFils),
        name,
      }),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('markPaid'),
          onPress: () => {
            payCardDue(
              due.id,
              status.remainingFils,
              {
                type: 'income',
                amountFils: status.remainingFils,
                category: 'other',
                accountId: due.accountId,
                title: `${name} payment`,
                date: todayISO,
                source: 'manual',
                isTransfer: true,
              },
              true,
            );
            onClose();
          },
        },
      ],
    );
  };

  const remindMe = async () => {
    const granted = await requestNotificationPermission();
    if (!granted) {
      Alert.alert(
        t('notifsAreOff'),
        t('notifsForCardDue'),
      );
      return;
    }
    await syncPaymentReminders(state);
    // The scheduler puts card dues at three days out and again on the day
    // (notifications.ts). Promising two days was a number nothing produced.
    Alert.alert(
      t('reminderSet'),
      tf('cardReminderBody', { date: shortDate(due.dueDate) }),
    );
  };

  return (
    <BottomSheet visible onClose={onClose} title={t('cardPaymentDue')}>
      <View style={styles.card}>
        <View style={styles.cardHead}>
          <ThemedText type="micro" style={{ color: '#8C857A' }}>
            {t('stillOwed')}
          </ThemedText>
          <ThemedText type="nano" style={{ color: theme.expense }}>
            {tf('dueDate', { date: shortDate(due.dueDate) })} ·{' '}
            {status.daysLeft < 0
              ? tf('lateDays', { days: -status.daysLeft })
              : tf('daysShort', { days: status.daysLeft })}
          </ThemedText>
        </View>
        <Money
          fils={status.remainingFils}
          type="sheetAmount"
          prefix={false}
          color="#F2EFE8"
        />
        <View style={styles.track}>
          <View
            style={[
              styles.fill,
              { width: `${Math.round(Math.min(1, Math.max(0, paidShare)) * 100)}%` },
            ]}
          />
        </View>
        <ThemedText type="nano" style={{ color: '#8C857A' }}>
          {tf('paidOfTotal', {
            paid: formatAmount(paid, { decimals: false }),
            total: formatAmount(due.totalDueFils, { decimals: false }),
          })}
          {/* Only the bank knows the minimum. When it never stated one, say
              nothing rather than quote the app's own 5% guess back as "Min". */}
          {status.minimumKnown
            ? ` · ${tf('minimumShort', { amount: formatAmount(due.minDueFils, { decimals: false }) })}`
            : ''}
        </ThemedText>
        {status.belowMinimum && (
          <ThemedText type="meta" style={{ color: theme.expense }}>
            {t('underMinimumDue')}
          </ThemedText>
        )}
      </View>

      <LabelTable
        rows={[
          {
            label: t('card'),
            value: <ThemedText type="small">{account?.name ?? t('card')}</ThemedText>,
          },
          {
            label: t('thisMonth'),
            value: (
              <ThemedText type="small" tabular>
                {tf('chargesAcross', {
                  amount: formatAmount(monthFils, { decimals: false }),
                  count: charges,
                  s: charges === 1 ? '' : 's',
                })}
              </ThemedText>
            ),
          },
          {
            label: t('matched'),
            value: (
              <ThemedText type="default" themeColor="textSecondary">
                {payments === 0
                  ? t('noCardPaymentYet')
                  : tf('matchedPayments', {
                      count: payments,
                      s: payments === 1 ? '' : 's',
                    })}
              </ThemedText>
            ),
          },
        ]}
      />

      <View style={styles.actions}>
        <Button inline label={t('markPaid')} onPress={markPaid} />
        <Button inline variant="outline" label={t('remindMe')} onPress={remindMe} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#16130F',
    borderRadius: 16,
    padding: Spacing.three + 2,
    gap: Spacing.two + 2,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  track: {
    height: 5,
    borderRadius: Radius.full,
    backgroundColor: '#302C25',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: Radius.full,
    backgroundColor: '#57B894',
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two + 2,
  },
});
