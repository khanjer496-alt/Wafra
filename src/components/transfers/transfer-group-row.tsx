import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { SelectionMark } from '@/components/transfers/transfer-select-mark';
import { RouteTag, TransferRoute } from '@/components/transfers/transfer-route-row';
import { Spacing, type BandPalette } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLedgerMoney } from '@/hooks/use-ledger-money';
import { formatAmount, shortDateWithYear } from '@/lib/format';
import { ledgerCurrencyDisplay } from '@/lib/markets';
import { transferActivityCopy } from '@/lib/transfer-activity-copy';
import type { RouteEnd } from '@/lib/transfer-list';

/** What one group row draws: the account, the other side, the entries' total and how many there are. */
export interface TransferGroupView {
  key: string;
  ids: string[];
  direction: 'income' | 'expense';
  from: RouteEnd; to: RouteEnd;
  /** Chip labels; an unknown side is drawn as the dashed "?" and spoken by `toSpoken`/`fromSpoken`. */
  fromLabel: string; toLabel: string;
  fromSpoken: string; toSpoken: string;
  totalFils: number;
  count: number;
  /** The newest entry's date, and the oldest's when they differ. */
  newest: string; oldest: string;
  /** "Looks like your ADCB Credit Card ••7720" when every entry points at the same other account. */
  hint?: string;
  /**
   * One answer may be given to all its entries (see TransferAnswerGroup.whole). A catch-all
   * group is not one tick in select mode: it opens to show its entries, each ticked on its own.
   */
  whole: boolean;
  /** Read-only: why its entries cannot be answered here (an id stored twice). */
  blocked?: string;
}

const stripDot = (name: string) => name.replace(/\.+$/, '');

/**
 * Several entries with the same account and the same other side, drawn as one
 * Transfers route with an "N entries" count. Tapping it asks the one question
 * for all of them; in select mode it is one tick. A catch-all group lists its
 * entries instead, and in select mode opens to show them (`expand`). A blocked
 * group is drawn with its reason and cannot be pressed.
 */
export function TransferGroupRow({ group, palette, first, onPress, select, expand }: {
  group: TransferGroupView; palette: BandPalette; first: boolean; onPress: () => void;
  select?: { checked: boolean; disabled?: boolean };
  /** Select mode, a catch-all group: a disclosure for its entries instead of a tick. */
  expand?: { expanded: boolean; disabled?: boolean };
}) {
  const words = transferActivityCopy(useLanguage());
  const slate = useBand('accounts').tint;
  const ledgerMoney = useLedgerMoney();
  const incoming = group.direction === 'income';
  const dates = group.oldest !== group.newest
    ? words.dateRange(shortDateWithYear(group.oldest), shortDateWithYear(group.newest)) : shortDateWithYear(group.newest);
  const amountWord = `${ledgerMoney?.currency ?? ledgerCurrencyDisplay()} ${formatAmount(group.totalFils, { decimals: true })}`;
  const label = [`${stripDot(group.fromSpoken)} ${words.route.to} ${stripDot(group.toSpoken)}`,
    words.group.entries(group.count), incoming ? words.incoming : words.outgoing, amountWord, dates,
    words.tags.needsAnswer, group.hint, group.blocked].filter(Boolean).join('. ');
  const body = <>
    <TransferRoute from={group.from} to={group.to} fromLabel={group.fromLabel} toLabel={group.toLabel}
      amountFils={group.totalFils} sign={incoming ? 'plus' : 'minus'} palette={palette} testID={`transfer-group-route-${group.key}`} />
    <View style={styles.meta}>
      {group.count > 1 ? <View testID="transfer-group-count" style={[styles.count, { backgroundColor: palette.glyphGround }]}>
        <ThemedText type="meta" style={{ color: palette.text }}>{words.group.entries(group.count)}</ThemedText>
      </View> : null}
      <ThemedText type="meta" style={{ color: palette.textSecondary }}>{dates}</ThemedText>
      <RouteTag tag="needs-answer" label={words.tags.needsAnswer} palette={palette} slate={slate} />
    </View>
    {group.hint ? <ThemedText type="meta" style={{ color: palette.textSecondary }}>{group.hint}</ThemedText> : null}
    {group.blocked ? <ThemedText testID="transfer-group-blocked" type="meta" style={{ color: palette.textSecondary }}>{group.blocked}</ThemedText> : null}
    {expand ? <View style={styles.expand}>
      <View style={expand.expanded ? styles.flip : undefined}><Icon name="chevron-down" size={16} color={palette.tint} /></View>
      <ThemedText type="smallBold" style={{ color: palette.tint }}>{expand.expanded ? words.group.hideEntries : words.group.showEntries}</ThemedText>
    </View> : null}
  </>;
  const divider = !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.rule };
  if (group.blocked) {
    // Shown so nothing waiting is hidden, but never pressed, ticked or saved.
    return <View testID={`transfer-group-${group.key}`} accessible accessibilityRole="text" accessibilityLabel={label}
      style={[styles.row, divider]}>{body}</View>;
  }
  if (expand) {
    return <Pressable testID={`transfer-group-${group.key}`} accessibilityRole="button"
      accessibilityLabel={`${label}. ${expand.expanded ? words.group.hideEntries : words.group.showEntries}`}
      accessibilityState={{ expanded: expand.expanded, disabled: !!expand.disabled }} aria-expanded={expand.expanded}
      disabled={expand.disabled} onPress={onPress}
      style={({ pressed }) => [styles.row, divider, { opacity: pressed ? 0.7 : 1 }]}>{body}</Pressable>;
  }
  return <Pressable testID={`transfer-group-${group.key}`} accessibilityRole={select ? 'checkbox' : 'button'}
    accessibilityLabel={select ? `${words.select.item}. ${label}` : label}
    accessibilityState={select ? { checked: select.checked, disabled: !!select.disabled } : undefined}
    aria-checked={select ? select.checked : undefined} disabled={select?.disabled} onPress={onPress}
    style={({ pressed }) => [styles.row, divider, { opacity: pressed ? 0.7 : 1 }]}>
    {select ? <View style={styles.selectRow}>
      <SelectionMark checked={select.checked} palette={palette} />
      <View style={styles.selectBody}>{body}</View>
    </View> : body}
  </Pressable>;
}

const styles = StyleSheet.create({
  row: { minHeight: 64, paddingVertical: Spacing.three, gap: Spacing.one },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  count: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  selectRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  selectBody: { flex: 1, minWidth: 0, gap: Spacing.one },
  expand: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 6 },
  flip: { transform: [{ rotate: '180deg' }] },
});
