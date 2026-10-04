import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { TransferAnswerChoices } from '@/components/transfers/transfer-answer-choices';
import { Money } from '@/components/ui/money';
import { Spacing, type BandPalette } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { shortDate } from '@/lib/format';
import type { TransferAnswer } from '@/lib/transfer-answer';
import { transferActivityCopy } from '@/lib/transfer-activity-copy';
import type { Transaction } from '@/lib/types';

export function TransferQuestionCard({ transaction, index, total, accountLabel, hint, palette, busy, onAnswer, onSeeAll }: {
  transaction: Transaction; index: number; total: number; accountLabel: string; hint?: string;
  palette: BandPalette; busy: boolean; onAnswer: (answer: TransferAnswer) => void; onSeeAll: () => void;
}) {
  const words = transferActivityCopy(useLanguage());
  const incoming = transaction.type === 'income';
  return <View testID="transfer-question-card" accessibilityLiveRegion="polite"
    style={[styles.card, { backgroundColor: palette.card, borderColor: palette.statusNear }]}>
    <View style={styles.head}>
      <ThemedText type="smallBold" accessibilityRole="header" style={{ color: palette.statusNear }}>{words.card.title(total)}</ThemedText>
      <ThemedText type="meta" style={{ color: palette.statusNear }}>{words.card.step(index + 1, total)}</ThemedText>
    </View>
    <View style={styles.what}>
      <View style={styles.grow}>
        <ThemedText type="smallBold">{incoming ? words.card.whereIn : words.card.whereOut}</ThemedText>
        <ThemedText type="meta" themeColor="textSecondary">
          {[accountLabel, shortDate(transaction.date), hint].filter(Boolean).join(' · ')}
        </ThemedText>
      </View>
      <Money fils={transaction.amountFils} sign={incoming ? 'plus' : 'minus'} type="smallBold" decimals />
    </View>
    <TransferAnswerChoices incoming={incoming} value={null} onChange={onAnswer} palette={palette} layout="buttons" disabled={busy} />
    {total > 1 ? <Pressable testID="transfer-question-see-all" accessibilityRole="button" onPress={onSeeAll} style={styles.seeAll}>
      <ThemedText type="small" style={{ color: palette.tint }}>{words.card.seeAll(total)}</ThemedText>
    </Pressable> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 18, padding: Spacing.three, gap: Spacing.two },
  head: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: Spacing.two },
  what: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  seeAll: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
});
