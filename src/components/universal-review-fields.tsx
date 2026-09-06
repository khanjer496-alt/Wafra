import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Spacing, Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t, type StringKey } from '@/lib/i18n';
import type { UniversalBankEvent, UniversalField, UniversalInstrument, UniversalMoney } from '@/lib/universal-types';

export const moneyChoiceKey = (money: UniversalMoney): string =>
  money.currency + ':' + money.exponent + ':' + money.minorUnits;

/** Decimal strings keep every minor unit, including zero/three-decimal currencies. */
export function universalMoneyLabel(money: UniversalMoney): string {
  const negative = money.minorUnits.startsWith('-');
  const digits = (negative ? money.minorUnits.slice(1) : money.minorUnits).padStart(money.exponent + 1, '0');
  const number = money.exponent === 0 ? digits
    : digits.slice(0, -money.exponent) + '.' + digits.slice(-money.exponent);
  return money.currency + ' ' + (negative ? '−' : '') + number;
}

export function universalChoices<T>(field: UniversalField<T>, key: (value: T) => string): T[] {
  const values = field.value === null ? field.alternatives : [field.value, ...field.alternatives];
  return [...new Map(values.map((value) => [key(value), value])).values()];
}

export const isOrdinaryUniversalPosting = (event: UniversalBankEvent): boolean =>
  ['purchase', 'transfer', 'cash-withdrawal', 'refund', 'fee', 'utility', 'recurring-payment', 'unknown'].includes(event.family) &&
  (event.status === 'posted' || event.status === 'unknown');

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="radio" accessibilityLabel={label}
      accessibilityState={{ selected, checked: selected }} onPress={onPress}
      style={[styles.choice, { borderColor: selected ? theme.primary : theme.controlBorder,
        backgroundColor: selected ? theme.backgroundSelected : theme.background }]}>
      <ThemedText type="smallBold" style={styles.choiceText}>{label}</ThemedText>
      <View style={[styles.selectionMark, { borderColor: selected ? theme.primary : theme.controlBorder }]}>{selected ? <Icon name="check" size={14} color={theme.primary} /> : null}</View>
    </Pressable>
  );
}

export function UniversalReviewFacts({ event, includeAmount = false }: { event: UniversalBankEvent; includeAmount?: boolean }) {
  const moneyFacts: [StringKey, UniversalField<UniversalMoney>][] = [
    ...(includeAmount ? [['genericAmount', event.amount] as [StringKey, UniversalField<UniversalMoney>]] : []),
    ['genericStatementTotal', event.statementTotal], ['genericMinimumDue', event.minimumDue],
    ['genericBalance', event.balance], ['genericCreditLimit', event.creditLimit],
  ];
  const dates: [StringKey, UniversalField<string>][] = [
    ...(includeAmount ? [['genericTransactionDate', event.transactionDate] as [StringKey, UniversalField<string>]] : []),
    ['genericStatementDate', event.statementDate], ['genericDueDate', event.dueDate],
  ];
  return (
    <View style={styles.facts}>
      {moneyFacts.filter(([, field]) => field.evidence !== 'missing').map(([label, field]) => (
        <View key={label} style={styles.fact}>
          <ThemedText type="meta" themeColor="textSecondary">{t(label)}</ThemedText>
          <ThemedText type="smallBold" tabular>
            {universalChoices(field, moneyChoiceKey).map(universalMoneyLabel).join(' / ')}
          </ThemedText>
        </View>
      ))}
      {dates.filter(([, field]) => field.evidence !== 'missing').map(([label, field]) => (
        <View key={label} style={styles.fact}>
          <ThemedText type="meta" themeColor="textSecondary">{t(label)}</ThemedText>
          <ThemedText type="smallBold">{universalChoices(field, String).join(' / ')}</ThemedText>
        </View>
      ))}
      {event.family === 'statement' && event.statementTotal.evidence === 'missing' ? (
        <ThemedText type="small" themeColor="textSecondary">{t('genericMissingStatementTotal')}</ThemedText>
      ) : null}
    </View>
  );
}

export function UniversalReviewFields({ event, money, onMoneyChange, instrument, onInstrumentChange,
  postedConfirmed, onPostedConfirmed, date, onDateChange, observedDate, observedDateLabel }: {
  event: UniversalBankEvent;
  money: UniversalMoney | null;
  onMoneyChange: (value: UniversalMoney) => void;
  instrument: UniversalInstrument | null;
  onInstrumentChange: (value: UniversalInstrument) => void;
  postedConfirmed: boolean;
  onPostedConfirmed: (value: boolean) => void;
  date: string;
  onDateChange: (value: string) => void;
  observedDate: string;
  observedDateLabel?: string;
}) {
  const theme = useTheme();
  const choices = universalChoices(event.amount, moneyChoiceKey).filter((value) => /^[1-9]\d*$/.test(value.minorUnits));
  const instruments = universalChoices(event.instrument, (value) => value.kind + ':' + value.last4);
  const dates = universalChoices(event.transactionDate, String);
  return (
    <View style={styles.fields}>
      <ThemedText type="smallBold">{t(choices.length > 1 ? 'genericChooseAmount' : 'genericAmount')}</ThemedText>
      {choices.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">{t('genericMissingAmount')}</ThemedText>
      ) : choices.length === 1 && event.amount.evidence === 'explicit' ? (
        <ThemedText type="title" tabular style={styles.amount}>{universalMoneyLabel(choices[0])}</ThemedText>
      ) : choices.map((choice) => (
        <Choice key={moneyChoiceKey(choice)} label={universalMoneyLabel(choice)}
          selected={!!money && moneyChoiceKey(money) === moneyChoiceKey(choice)} onPress={() => onMoneyChange(choice)} />
      ))}
      {event.instrument.evidence === 'ambiguous' ? (
        <View style={styles.fields}>
          <ThemedText type="smallBold">{t('genericChooseInstrument')}</ThemedText>
          {instruments.map((choice) => (
            <Choice key={choice.kind + ':' + choice.last4}
              label={t(choice.kind === 'card' ? 'genericCard' : choice.kind === 'account' ? 'genericAccount' : 'genericWallet') +
                (choice.last4 ? ' •' + choice.last4 : '')}
              selected={instrument?.kind === choice.kind && instrument?.last4 === choice.last4}
              onPress={() => onInstrumentChange(choice)} />
          ))}
        </View>
      ) : null}
      {event.transactionDate.evidence !== 'explicit' ? (
        <View style={styles.fields}>
          <ThemedText type="smallBold">{t('genericChooseDate')}</ThemedText>
          {dates.map((choice) => <Choice key={choice} label={choice} selected={date === choice} onPress={() => onDateChange(choice)} />)}
          <Choice label={(observedDateLabel ?? t('genericUseMessageDate')) + ' · ' + observedDate}
            selected={date === observedDate} onPress={() => onDateChange(observedDate)} />
        </View>
      ) : null}
      {event.status === 'unknown' ? (
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: postedConfirmed }}
          accessibilityLabel={t('genericConfirmPosted')} onPress={() => onPostedConfirmed(!postedConfirmed)}
          style={[styles.choice, { borderColor: theme.controlBorder }]}>
          <ThemedText type="small" style={styles.choiceText}>{t('genericConfirmPosted')}</ThemedText>
          <View style={[styles.selectionMark, { borderColor: theme.controlBorder }]}>{postedConfirmed ? <Icon name="check" size={14} color={theme.primary} /> : null}</View>
        </Pressable>
      ) : null}
      <UniversalReviewFacts event={event} />
    </View>
  );
}

const styles = StyleSheet.create({
  selectionMark: { width: 20, height: 20, borderRadius: 4, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  fields: { gap: Spacing.two },
  choice: { minHeight: 48, padding: Spacing.three, borderWidth: 1, borderRadius: Radius.md,
    flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  choiceText: { flex: 1 },
  amount: { fontSize: 30, lineHeight: 38 },
  facts: { gap: Spacing.three },
  fact: { gap: Spacing.one },
});
