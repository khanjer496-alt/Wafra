import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Button } from '@/components/ui/controls';
import { LabelTable } from '@/components/ui/layout';
import { Money } from '@/components/ui/money';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { dueWithStatus, duePaidFils, duePayments } from '@/lib/cards';
import { formatAED, formatAmount, monthKey, shortDate, toISODate } from '@/lib/format';
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

  /**
   * The clock is read when the sheet OPENS, not when this component mounts.
   *
   * Home renders `<CardPaymentSheet due={cardDue} />` unconditionally and this
   * function returns null while `due` is null, so the component is mounted for
   * the entire life of the Home tab. A `useMemo(() => new Date(), [])` therefore
   * froze at tab mount: an app left resident for three days showed a `daysLeft`
   * three days stale and — worse — filed the "Mark paid" transfer dated three
   * days ago, which is far enough back to fall outside the window that folds it
   * together with the bank's receipt, so the same money imported twice.
   *
   * `due` is null between openings, so the dependency really does change on
   * every open even when the same statement is reopened.
   */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (due) setNow(new Date());
  }, [due]);

  const [confirming, setConfirming] = useState(false);
  /**
   * What "Remind me" has to say, drawn in the sheet instead of announced.
   *
   * Both outcomes — permission refused, reminder scheduled — went through
   * `Alert.alert`, which is an empty method on react-native-web: the button
   * scheduled the reminder and then said nothing whatsoever, so the only
   * evidence it had worked was a notification three days later. An inline
   * line under the actions is visible on every platform and does not cover
   * the figures the user came here to read.
   */
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null);
  useEffect(() => {
    // A new statement is a new sheet: neither the confirmation nor the last
    // reminder's answer belongs to it.
    setConfirming(false);
    setNotice(null);
  }, [due]);

  const data = useMemo(() => {
    if (!due) return null;
    // The prop is a snapshot Home captured when the row was tapped, and the
    // store moves underneath it: a relay import that arrives with the sheet
    // open can settle this very statement. Read the live row so the figures —
    // and the Mark paid amount computed from them — are the current ones.
    const live = state.cardDues.find((d) => d.id === due.id) ?? due;
    const status = dueWithStatus(state, live, now);
    const paid = duePaidFils(state, live);
    const account = state.accounts.find((a) => a.id === live.accountId);

    // What this card has been charged in the current month, which is the
    // figure the next statement is being built from.
    const key = monthKey(now);
    let monthFils = 0;
    let charges = 0;
    for (const t of state.transactions) {
      if (t.accountId !== live.accountId || t.isTransfer || t.type !== 'expense') continue;
      if (monthKey(t.date) !== key) continue;
      monthFils += t.amountFils;
      charges += 1;
    }

    // What the allocator actually credited to THIS statement. Counting every
    // income-side transfer on the account instead read "6 payments matched"
    // beside a statement one payment had settled.
    const payments = duePayments(state, live).length;

    return { live, status, paid, account, monthFils, charges, payments };
  }, [due, state, now]);

  if (!due || !data) return null;

  const { live, status, paid, account, monthFils, charges, payments } = data;
  const paidShare = live.totalDueFils > 0 ? paid / live.totalDueFils : 0;
  // Nothing left to pay is not a payment. Without this, a background import
  // that settled the statement while the sheet was open still let Mark paid
  // file a zero-fils income transfer against the card.
  const canMarkPaid = status.remainingFils > 0;

  const name = account?.name ?? 'Card';

  // The payment itself. Reachable from the confirmation sheet and from
  // nowhere else — it used to live inside an alert button's `onPress`, which
  // on the web export was code no tap could ever reach.
  const filePayment = () => {
    payCardDue(
      live.id,
      status.remainingFils,
      {
        type: 'income',
        amountFils: status.remainingFils,
        category: 'other',
        accountId: live.accountId,
        title: `${name} payment`,
        date: toISODate(new Date()),
        source: 'manual',
        isTransfer: true,
      },
      true,
    );
    onClose();
  };

  const remindMe = async () => {
    const granted = await requestNotificationPermission();
    if (!granted) {
      setNotice({ title: t('notifsAreOff'), body: t('notifsForCardDue') });
      return;
    }
    await syncPaymentReminders(state);
    // The scheduler puts card dues at three days out and again on the day
    // (notifications.ts). Promising two days was a number nothing produced.
    setNotice({
      title: t('reminderSet'),
      body: tf('cardReminderBody', { date: shortDate(live.dueDate) }),
    });
  };

  return (
    <BottomSheet visible onClose={onClose} title={t('cardPaymentDue')}>
      <View style={styles.card}>
        <View style={styles.cardHead}>
          <ThemedText type="micro" style={{ color: '#8C857A' }}>
            {t('stillOwed')}
          </ThemedText>
          <ThemedText type="nano" style={{ color: theme.expense }}>
            {tf('dueDate', { date: shortDate(live.dueDate) })} ·{' '}
            {status.daysLeft < 0
              ? tf('lateDays', { days: -status.daysLeft })
              : tf('daysShort', { days: status.daysLeft })}
          </ThemedText>
        </View>
        {/* The hero carried no unit at all — "1,000" on the one screen whose
            entire purpose is to say how much money to move. `Money`'s default
            prefix is the active market's code, the same one every other figure
            in the app is shown under. */}
        <Money fils={status.remainingFils} type="sheetAmount" color="#F2EFE8" />
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
            total: formatAED(live.totalDueFils, { decimals: false }),
          })}
          {/* Only the bank knows the minimum. When it never stated one, say
              nothing rather than quote the app's own 5% guess back as "Min". */}
          {status.minimumKnown
            ? ` · ${tf('minimumShort', { amount: formatAED(live.minDueFils, { decimals: false }) })}`
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
                  amount: formatAED(monthFils, { decimals: false }),
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
        <Button
          inline
          label={t('markPaid')}
          onPress={() => setConfirming(true)}
          disabled={!canMarkPaid}
        />
        <Button inline variant="outline" label={t('remindMe')} onPress={remindMe} />
      </View>

      {notice && (
        <View
          accessibilityLiveRegion="polite"
          style={[
            styles.notice,
            { borderColor: theme.cardBorder, backgroundColor: theme.backgroundElement },
          ]}>
          <ThemedText type="smallBold">{notice.title}</ThemedText>
          <ThemedText type="meta" themeColor="textSecondary">
            {notice.body}
          </ThemedText>
        </View>
      )}

      {/* Nested inside this sheet rather than beside it: a Modal presented
          from within the presented one stacks, where dismissing this sheet
          and presenting another in the same frame does not. */}
      {confirming && (
        <ConfirmSheet
          visible
          onClose={() => setConfirming(false)}
          question={t('markStatementPaid')}
          body={tf('fileCardPaymentBody', {
            amount: formatAED(status.remainingFils),
            name,
          })}
          confirmLabel={t('markPaid')}
          onConfirm={filePayment}
        />
      )}
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
  notice: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sheet,
    padding: Spacing.three,
    gap: Spacing.half,
  },
});
