import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { TransferAnswerChoices } from '@/components/transfers/transfer-answer-choices';
import { PersonAvatar, personMoneyLine } from '@/components/transfers/transfer-person-row';
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
export function TransferQuestionCard({ transaction, person, index, total, waiting: waitingCount, more = 0, accountLabel, hint, palette, busy,
  onAnswer, onSeeAll }: {
  /** The entry asked about; or `person`. */
  transaction?: Transaction;
  /** A person asked about as a whole. */
  person?: TransferPersonGroup;
  /** This question's place in the card's questions, and how many questions there are. */
  index: number; total: number;
  /** Transfers waiting for an answer (a person counts every transfer); the questions when not given. */
  waiting?: number;
  /** Queued entries this card cannot ask about; "See all" stays open while there are any. */
  more?: number;
  accountLabel?: string; hint?: string;
  palette: BandPalette; busy: boolean; onAnswer: (answer: TransferAnswer) => void; onSeeAll: () => void;
}) {
  const words = transferActivityCopy(useLanguage());
  const large = useLargeTextLayout();
  const ledgerMoney = useLedgerMoney();
  const incoming = person ? person.direction === 'between' ? 'mixed' as const : person.direction === 'income'
    : transaction?.type === 'income';
  // Everything waiting for an answer, the card's own questions and the ones it cannot ask, so the
  // title and See all never disagree. The step only counts when the card can walk all of them.
  const waiting = (waitingCount ?? total) + more;
  const money = (fils: number) => `${ledgerMoney?.currency ?? ledgerCurrencyDisplay()} ${formatAmount(fils, { decimals: true })}`;
  const what = person ? <View testID="transfer-question-person" style={styles.person}>
    <PersonAvatar initial={person.initial} palette={palette} />
    <View style={styles.grow}>
      <ThemedText type="smallBold">{words.person.question(person.name)}</ThemedText>
      <ThemedText type="meta" themeColor="textSecondary">
        {transferMetaLine([words.person.transfers(person.ids.length), personMoneyLine(person, words, money),
          person.oldest !== person.newest ? words.dateRange(shortDateWithYear(person.oldest), shortDateWithYear(person.newest))
            : unbroken(shortDateWithYear(person.newest))])}
      </ThemedText>
    </View>
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
    <View style={styles.head}>
      <ThemedText type="smallBold" accessibilityRole="header" style={{ color: palette.statusNear }}>{words.card.title(waiting)}</ThemedText>
      {more === 0 ? <ThemedText type="meta" style={{ color: palette.statusNear }}>{words.card.step(index + 1, total)}</ThemedText> : null}
    </View>
    {what}
    <TransferAnswerChoices incoming={incoming} value={null} onChange={onAnswer} palette={palette} layout="buttons" disabled={busy} />
    {waiting > 1 ? <Pressable testID="transfer-question-see-all" accessibilityRole="button" onPress={onSeeAll} style={styles.seeAll}>
      {/* The title already says how many. */}
      <ThemedText type="small" style={{ color: palette.tint }}>{words.card.seeAllPlain}</ThemedText>
    </Pressable> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 18, padding: Spacing.three, gap: Spacing.two },
  head: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: Spacing.two },
  what: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  whatLarge: { flexDirection: 'column', alignItems: 'flex-start', gap: Spacing.two },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  person: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  seeAll: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
});
