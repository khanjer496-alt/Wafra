import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Button } from '@/components/ui/controls';
import { LabelTable } from '@/components/ui/layout';
import { Money } from '@/components/ui/money';
import { ProgressBar } from '@/components/ui/progress-bar';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { dueWithStatus, duePaidFils, duePayments } from '@/lib/cards';
import { formatAED, formatAmount, monthKey, parseAmountWithMoneySpec, shortDate, toISODate } from '@/lib/format';
import { internalTransferIdsForState, isSpending } from '@/lib/ledger';
import { cardPaymentOptions, resolveCardPayment, type CardPaymentChoice } from '@/lib/money-places';
import { moneyPlacesWords } from '@/lib/money-places-copy';
import { requestNotificationPermission, syncPaymentReminders } from '@/lib/notifications';
import { useStore } from '@/lib/store';
import type { CardDue } from '@/lib/types';
import { t, tf } from '@/lib/i18n';

interface CardPaymentSheetProps {
  /** The statement to settle, or null to keep the sheet closed. */
  due: CardDue | null;
  onClose: () => void;
  /** Which amount starts selected. Minimum falls back to full when the bank stated none. */
  initialChoice?: CardPaymentChoice;
}

/**
 * Record a payment the user made toward one credit-card statement.
 *
 * Wafra moves no money: this files the payment the user already made from
 * their bank, as a transfer onto the card, through the same `payCardDue` path
 * and allocator every other card payment uses. Three amounts: what is left on
 * the statement, what is left of a minimum the bank actually STATED, or
 * another amount up to what is left. There is deliberately no source account
 * or date picker — a guessed source would double the bank's own alert.
 */
export function CardPaymentSheet({ due, onClose, initialChoice = 'full' }: CardPaymentSheetProps) {
  const theme = useTheme();
  const language = useLanguage();
  const w = moneyPlacesWords(language);
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
  const [choice, setChoice] = useState<CardPaymentChoice>(initialChoice);
  const [otherText, setOtherText] = useState('');
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
    // A new statement is a new sheet: neither the confirmation, the amount
    // chosen, nor the last reminder's answer belongs to it.
    setConfirming(false);
    setNotice(null);
    setChoice(initialChoice);
    setOtherText('');
  }, [due, initialChoice]);

  const data = useMemo(() => {
    if (!due) return null;
    // The prop is a snapshot Home captured when the row was tapped, and the
    // store moves underneath it: a relay import that arrives with the sheet
    // open can settle this very statement. Read the live row so the figures —
    // and the amounts offered from them — are the current ones.
    const live = state.cardDues.find((d) => d.id === due.id) ?? due;
    const status = dueWithStatus(state, live, now);
    const paid = duePaidFils(state, live);
    const account = state.accounts.find((a) => a.id === live.accountId);
    const options = cardPaymentOptions({ due: live, remainingFils: status.remainingFils });

    // What this card has been charged in the current month, which is the
    // figure the next statement is being built from.
    const key = monthKey(now);
    const internal = internalTransferIdsForState(state);
    let monthFils = 0;
    let charges = 0;
    for (const t of state.transactions) {
      if (t.accountId !== live.accountId || !isSpending(t, undefined, internal)) continue;
      if (monthKey(t.date) !== key) continue;
      monthFils += t.amountFils;
      charges += 1;
    }

    // What the allocator actually credited to THIS statement. Counting every
    // income-side transfer on the account instead read "6 payments matched"
    // beside a statement one payment had settled.
    const payments = duePayments(state, live).length;

    return { live, status, paid, account, options, monthFils, charges, payments };
  }, [due, state, now]);

  if (!due || !data) return null;

  const { live, status, paid, account, options, monthFils, charges, payments } = data;
  const paidShare = live.totalDueFils > 0 ? paid / live.totalDueFils : 0;
  // "Minimum" is only an answer when the bank stated one that is still open.
  const selected: CardPaymentChoice = choice === 'minimum' && options.minimumFils === null ? 'full' : choice;
  const otherFils = otherText.trim() === '' || !state.ledgerMoney
    ? null
    : parseAmountWithMoneySpec(otherText, state.ledgerMoney);
  const resolution = resolveCardPayment(selected, otherFils, options);
  // Nothing left to pay is not a payment. A background import that settled
  // the statement while the sheet was open cannot file a zero-fils transfer.
  const canRecord = resolution.ok;
  const otherProblem = selected === 'other' && otherText.trim() !== '' && !resolution.ok
    ? resolution.reason === 'over-remaining'
      ? w.overRemaining(formatAED(options.fullFils))
      : w.invalidAmount
    : null;

  const name = account?.name ?? t('card');

  // The payment itself. Reachable from the confirmation sheet and from
  // nowhere else — it used to live inside an alert button's `onPress`, which
  // on the web export was code no tap could ever reach.
  const filePayment = () => {
    if (!resolution.ok) return;
    payCardDue(
      live.id,
      resolution.amountFils,
      {
        type: 'income',
        amountFils: resolution.amountFils,
        category: 'other',
        accountId: live.accountId,
        title: tf('accountPaymentTitle', { name }),
        date: toISODate(new Date()),
        source: 'manual',
        isTransfer: true,
      },
      resolution.settles,
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
    // (reminders.ts). Promising two days was a number nothing produced.
    setNotice({
      title: t('reminderSet'),
      body: tf('cardReminderBody', { date: shortDate(live.dueDate) }),
    });
  };

  const choices: { value: CardPaymentChoice; label: string; fils: number | null }[] = [
    { value: 'full', label: paid > 0 ? w.restOfStatement : w.fullStatement, fils: options.fullFils },
    ...(options.minimumFils !== null
      ? [{ value: 'minimum' as const, label: paid > 0 ? w.restOfMinimum : w.minimumDue, fils: options.minimumFils }]
      : []),
    { value: 'other', label: w.anotherAmount, fils: null },
  ];

  return (
    <BottomSheet visible onClose={onClose} title={w.cardPaymentTitle}>
      <View style={styles.head} testID="card-payment-status">
        <ThemedText type="smallBold">{w.cardPaymentFor(name, shortDate(live.dueDate))}</ThemedText>
        <ThemedText type="meta" style={{ color: status.daysLeft < 0 ? theme.expense : theme.textSecondary }}>
          {status.daysLeft < 0
            ? tf('lateDays', { days: -status.daysLeft })
            : tf('daysShort', { days: status.daysLeft })}
        </ThemedText>
        <Money fils={status.remainingFils} type="sheetAmount" />
        {paidShare > 0 && <ProgressBar ratio={paidShare} color={theme.income} height={5} />}
        <ThemedText type="meta" themeColor="textSecondary">
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

      {status.remainingFils > 0 ? (
        <View accessibilityRole="radiogroup" style={styles.choices} testID="card-payment-choices">
          {choices.map((option, index) => {
            const active = selected === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
                accessibilityLabel={option.fils !== null ? `${option.label}, ${formatAED(option.fils)}` : option.label}
                testID={`card-payment-${option.value}`}
                onPress={() => setChoice(option.value)}
                style={({ pressed }) => [
                  styles.choice,
                  index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.cardBorder },
                  pressed && { backgroundColor: theme.backgroundSelected },
                ]}>
                <View style={[styles.radio, { borderColor: active ? theme.primary : theme.controlBorder }]}>
                  {active && <View style={[styles.radioDot, { backgroundColor: theme.primary }]} />}
                </View>
                <ThemedText type={active ? 'smallBold' : 'small'} style={styles.grow}>{option.label}</ThemedText>
                {option.fils !== null && <Money fils={option.fils} type="smallBold" />}
              </Pressable>
            );
          })}
          {selected === 'other' && (
            <View style={styles.other}>
              <TextField
                numeric
                label={w.amountField}
                value={otherText}
                onChangeText={setOtherText}
                placeholder={formatAmount(options.fullFils)}
                leading={(
                  <ThemedText type="smallBold" themeColor="textSecondary">
                    {state.ledgerMoney?.currency ?? '—'}
                  </ThemedText>
                )}
              />
              {otherProblem && (
                <ThemedText type="meta" accessibilityLiveRegion="polite" style={{ color: theme.expense }}>
                  {otherProblem}
                </ThemedText>
              )}
            </View>
          )}
        </View>
      ) : null}

      <ThemedText type="meta" themeColor="textSecondary">{w.paymentNote}</ThemedText>

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
          label={w.recordThisPayment}
          onPress={() => setConfirming(true)}
          disabled={!canRecord}
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
      {confirming && resolution.ok && (
        <ConfirmSheet
          visible
          onClose={() => setConfirming(false)}
          question={resolution.settles ? t('markStatementPaid') : w.recordPartialQuestion}
          body={tf('fileCardPaymentBody', {
            amount: formatAED(resolution.amountFils),
            name,
          })}
          confirmLabel={w.recordThisPayment}
          onConfirm={filePayment}
        />
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  head: {
    gap: Spacing.two,
  },
  choices: {
    borderRadius: Radius.sheet,
  },
  choice: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    paddingVertical: Spacing.two,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  grow: { flex: 1, minWidth: 0 },
  other: {
    gap: Spacing.one,
    paddingBottom: Spacing.two,
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
