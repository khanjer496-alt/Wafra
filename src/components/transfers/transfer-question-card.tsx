import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { TransferAnswerChoices } from '@/components/transfers/transfer-answer-choices';
import { PersonAvatar, personMoneyLine } from '@/components/transfers/transfer-person-row';
import { nameDirection } from '@/components/transfers/transfer-route-row';
import { Money } from '@/components/ui/money';
import { Spacing, type BandPalette } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useLedgerMoney } from '@/hooks/use-ledger-money';
import { formatAmount, shortDateWithYear } from '@/lib/format';
import { ledgerCurrencyDisplay } from '@/lib/markets';
import type { TransferAnswer } from '@/lib/transfer-answer';
import { transferActivityCopy, transferMetaLine, unbroken } from '@/lib/transfer-activity-copy';
import type { TransferPersonGroup } from '@/lib/transfer-people';
import type { Transaction } from '@/lib/types';

/**
 * The Transfers page's one question at a time: one entry ("Where did this
 * go?"), or one person with every waiting transfer they sent or received
 * ("Mariam S: your own account or someone else?"). A person's answer opens
 * the confirmation sheet with the entries and their count before anything is
 * saved; an entry's answer is saved at once with Undo.
 */
export function TransferQuestionCard({ transaction, person, index, total, waiting: waitingCount, more = 0, accountLabel, hint,
  palette, busy, onAnswer }: {
  /** The entry asked about; or `person`. */
  transaction?: Transaction;
  /** A person asked about as a whole. */
  person?: TransferPersonGroup;
  /** This question's place in the card's questions, and how many questions there are. */
  index: number; total: number;
  /** Transfers waiting for an answer (a person counts every transfer); the questions when not given. */
  waiting?: number;
  /** Queued entries this card cannot ask about: counted in the title; the list below offers them. */
  more?: number;
  accountLabel?: string; hint?: string;
  palette: BandPalette; busy: boolean; onAnswer: (answer: TransferAnswer) => void;
}) {
  const words = transferActivityCopy(useLanguage());
  const large = useLargeTextLayout();
  const ledgerMoney = useLedgerMoney();
  const incoming = person ? person.direction === 'between' ? 'mixed' as const : person.direction === 'income'
    : transaction?.type === 'income';
  // Everything waiting for an answer, the card's own questions and the ones it cannot ask, so the
  // title and See all never disagree. The step counts the card's own questions (people and the
  // reconciler's queue); it is hidden only while queued entries wait that no question reaches.
  const waiting = (waitingCount ?? total) + more;
  const money = (fils: number) => `${ledgerMoney?.currency ?? ledgerCurrencyDisplay()} ${formatAmount(fils, { decimals: true })}`;
  // The person's name leads, then how many and when, then the money each way; the question is its own line.
  const what = person ? <View testID="transfer-question-person" style={styles.whoBlock}>
    <View style={styles.person}>
      <PersonAvatar initial={person.initial} palette={palette} size={44} />
      <View style={styles.grow}>
        <ThemedText type="subtitle" accessibilityLabel={words.person.question(person.name)}
          style={[styles.name, { writingDirection: nameDirection(person.name) }]}>{person.name}</ThemedText>
        <ThemedText type="meta" themeColor="textSecondary">
          {transferMetaLine([words.person.transfers(person.ids.length),
            person.oldest !== person.newest ? words.dateRange(shortDateWithYear(person.oldest), shortDateWithYear(person.newest))
              : unbroken(shortDateWithYear(person.newest))])}
        </ThemedText>
        <ThemedText type="meta" themeColor="textSecondary">{personMoneyLine(person, words, money)}</ThemedText>
      </View>
    </View>
    <ThemedText type="smallBold" importantForAccessibility="no" accessibilityElementsHidden>{words.person.who}</ThemedText>
  </View> : transaction ? <View testID="transfer-question-what" style={large ? styles.whatLarge : styles.what}>
    <View style={styles.grow}>
      <ThemedText type="smallBold">{incoming ? words.card.whereIn : words.card.whereOut}</ThemedText>
      <ThemedText type="meta" themeColor="textSecondary">
        {/* Each part isolated: a Latin account name and an Arabic date keep their own order. */}
        {transferMetaLine([accountLabel, unbroken(shortDateWithYear(transaction.date)), hint])}
      </ThemedText>
    </View>
    <Money fils={transaction.amountFils} sign={incoming ? 'plus' : 'minus'} type="smallBold" decimals />
  </View> : null;
  return <View testID="transfer-question-card" accessibilityLiveRegion="polite"
    style={[styles.card, { backgroundColor: palette.card, borderColor: palette.statusNear }]}>
    {/* The count is on the To answer tab above; the card names it to a screen reader and shows only its step. */}
    <View style={styles.head} accessible accessibilityRole="header"
      accessibilityLabel={more === 0 ? `${words.card.title(waiting)}. ${words.card.step(index + 1, total)}` : words.card.title(waiting)}>
      <ThemedText type="meta" style={{ color: palette.statusNear }}>{more === 0 ? words.card.step(index + 1, total) : words.card.title(waiting)}</ThemedText>
    </View>
    {what}
    {/* Full-width answers, each saying what it does to the totals. */}
    <TransferAnswerChoices incoming={incoming} value={null} onChange={onAnswer} palette={palette} layout="stack" disabled={busy} />
  </View>;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 18, padding: Spacing.three, gap: Spacing.two },
  head: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: Spacing.two },
  what: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  whatLarge: { flexDirection: 'column', alignItems: 'flex-start', gap: Spacing.two },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  person: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  whoBlock: { gap: Spacing.three },
  name: { flexShrink: 1 },
});
