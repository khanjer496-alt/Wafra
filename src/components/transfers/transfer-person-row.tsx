import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { SelectionMark } from '@/components/transfers/transfer-select-mark';
import { nameDirection, RouteTag } from '@/components/transfers/transfer-route-row';
import { Spacing, type BandPalette } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useLedgerMoney } from '@/hooks/use-ledger-money';
import { formatAmount, shortDateWithYear } from '@/lib/format';
import { ledgerCurrencyDisplay } from '@/lib/markets';
import { transferActivityCopy, transferMetaLine, unbroken } from '@/lib/transfer-activity-copy';
import type { TransferPersonPreview } from '@/lib/transfer-batch';

/** What one person row draws. */
export interface TransferPersonView extends TransferPersonPreview {
  key: string;
  ids: string[];
  /** The newest entry's date, and the oldest's when they differ. */
  newest: string; oldest: string;
}

/** The person's initial on the band fill: the avatar of a person group (and of its sheet and card). */
export function PersonAvatar({ initial, palette, size = 36 }: { initial: string; palette: BandPalette; size?: number }) {
  return <View importantForAccessibility="no" accessibilityElementsHidden
    style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: palette.fill }]}>
    <ThemedText type="smallBold" style={{ color: palette.onFill }}>{initial}</ThemedText>
  </View>;
}

/** "Sent AED 1,200.00 (3) · Received AED 400.00 (1)": each side only when there is money that way. */
export function personMoneyLine(person: TransferPersonPreview, words: ReturnType<typeof transferActivityCopy>,
  money: (fils: number) => string): string {
  return transferMetaLine([
    person.outgoing ? words.person.sent(unbroken(money(person.outFils)), person.outgoing) : null,
    person.incoming ? words.person.received(unbroken(money(person.inFils)), person.incoming) : null,
  ]);
}

/**
 * Every waiting transfer with one person, drawn as the person: their initial,
 * the name as the bank wrote it, how many transfers, the money each way and
 * the dates. Tapping it asks the one question for all of them ("your own
 * account or someone else?"); in select mode it is one tick.
 */
export function TransferPersonRow({ person, palette, first, onPress, select }: {
  person: TransferPersonView; palette: BandPalette; first: boolean; onPress: () => void;
  select?: { checked: boolean; disabled?: boolean };
}) {
  const words = transferActivityCopy(useLanguage());
  const slate = useBand('accounts').tint;
  const large = useLargeTextLayout();
  const ledgerMoney = useLedgerMoney();
  const money = (fils: number) => `${ledgerMoney?.currency ?? ledgerCurrencyDisplay()} ${formatAmount(fils, { decimals: true })}`;
  const count = person.incoming + person.outgoing;
  const dates = person.oldest !== person.newest
    ? words.dateRange(shortDateWithYear(person.oldest), shortDateWithYear(person.newest)) : shortDateWithYear(person.newest);
  const moneyLine = personMoneyLine(person, words, money);
  const label = [person.name, words.person.transfers(count), moneyLine, dates, words.tags.needsAnswer].join('. ');
  const body = <View style={[styles.body, large && styles.bodyLarge]}>
    <PersonAvatar initial={person.initial} palette={palette} />
    <View style={styles.text}>
      <View style={styles.head}>
        {/* The name keeps its own direction, so a Latin name on an Arabic page is cut at its end. */}
        <ThemedText type="smallBold" numberOfLines={large ? undefined : 1}
          style={[styles.name, { writingDirection: nameDirection(person.name) }]}>{person.name}</ThemedText>
        <View testID="transfer-person-count" style={[styles.count, { backgroundColor: palette.glyphGround }]}>
          <ThemedText type="meta" style={{ color: palette.text }}>{words.person.transfers(count)}</ThemedText>
        </View>
      </View>
      <ThemedText type="meta" style={{ color: palette.textSecondary }}>{moneyLine}</ThemedText>
      <View style={styles.meta}>
        <ThemedText type="meta" style={{ color: palette.textSecondary }}>{dates}</ThemedText>
        <RouteTag tag="needs-answer" label={words.tags.needsAnswer} palette={palette} slate={slate} />
      </View>
    </View>
  </View>;
  const divider = !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.rule };
  return <Pressable testID={`transfer-person-${person.key}`} accessibilityRole={select ? 'checkbox' : 'button'}
    accessibilityLabel={select ? `${words.select.item}. ${label}` : label}
    accessibilityHint={select ? undefined : words.person.question(person.name)}
    accessibilityState={select ? { checked: select.checked, disabled: !!select.disabled } : undefined}
    aria-checked={select ? select.checked : undefined} disabled={select?.disabled} onPress={onPress}
    style={({ pressed }) => [styles.row, divider, { opacity: pressed ? 0.7 : 1 }]}>
    {select ? <View style={styles.selectRow}>
      <SelectionMark checked={select.checked} palette={palette} />
      <View style={styles.selectBody}>{body}</View>
    </View> : body}
  </Pressable>;
}

/** "Show all 24 people" / "Show fewer people" under the first few people. */
export function TransferPeopleToggle({ label, palette, expanded, onPress }: {
  label: string; palette: BandPalette; expanded: boolean; onPress: () => void;
}) {
  return <Pressable testID="transfer-people-toggle" accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ expanded }} aria-expanded={expanded} onPress={onPress}
    style={({ pressed }) => [styles.toggle, { borderTopColor: palette.rule, opacity: pressed ? 0.7 : 1 }]}>
    <View style={expanded ? styles.flip : undefined}><Icon name="chevron-down" size={16} color={palette.tint} /></View>
    <ThemedText type="smallBold" style={{ color: palette.tint }}>{label}</ThemedText>
  </Pressable>;
}

const styles = StyleSheet.create({
  row: { minHeight: 64, paddingVertical: Spacing.three },
  body: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  bodyLarge: { flexDirection: 'column', gap: Spacing.two },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0, gap: 2, alignSelf: 'stretch' },
  head: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  name: { flexShrink: 1, minWidth: 0 },
  count: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two, marginTop: 2 },
  selectRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  selectBody: { flex: 1, minWidth: 0 },
  toggle: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 6, borderTopWidth: StyleSheet.hairlineWidth },
  flip: { transform: [{ rotate: '180deg' }] },
});
