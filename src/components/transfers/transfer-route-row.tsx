import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { Spacing, type BandPalette } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useLedgerMoney } from '@/hooks/use-ledger-money';
import { formatAmount, shortDate } from '@/lib/format';
import { ledgerCurrencyDisplay } from '@/lib/markets';
import { transferActivityCopy } from '@/lib/transfer-activity-copy';
import type { RouteEnd, TransferListItem } from '@/lib/transfer-list';

const firstLetter = (part: string) => Array.from(part)[0] ?? '';

function Chip({ end, label, palette, large }: { end: RouteEnd; label: string; palette: BandPalette; large: boolean }) {
  const initials = label.split(/\s+/).map(firstLetter).slice(0, 2).join('').toUpperCase();
  const unknown = end.kind === 'unknown';
  return <View style={[styles.chip, !large && styles.chipCapped, unknown
    ? { borderStyle: 'dashed', borderWidth: 1, borderColor: palette.textSecondary }
    : { backgroundColor: palette.glyphGround }]}>
    {unknown
      ? <ThemedText type="smallBold" themeColor="textSecondary" style={styles.unknownMark}>?</ThemedText>
      : initials ? <View style={[styles.initials, { backgroundColor: palette.fill }]}>
        <ThemedText type="micro" style={{ color: palette.onFill }}>{initials}</ThemedText>
      </View> : null}
    {unknown ? null
      : <ThemedText type="smallBold" numberOfLines={large ? undefined : 1} style={styles.chipText}>{label}</ThemedText>}
  </View>;
}

/**
 * Tag colours: own is slate (the Accounts band tint, so it stays slate wherever
 * the row is shown), someone else is gold (`statusNear` on its soft ground), and
 * needs-an-answer is the filled warning pill (the same gold, solid, so it outranks the rest).
 */
function Tag({ tag, label, palette, slate }: { tag: TransferListItem['tag']; label: string; palette: BandPalette; slate: string }) {
  const look = tag === 'own' ? { backgroundColor: palette.glyphGround, color: slate }
    : tag === 'external' ? { backgroundColor: palette.statusNearSoft, color: palette.statusNear }
      : tag === 'needs-answer' ? { backgroundColor: palette.statusNear, color: palette.sheet }
        : { backgroundColor: 'transparent', color: palette.textSecondary };
  return <View style={[styles.tag, { backgroundColor: look.backgroundColor }]}>
    <ThemedText type="meta" style={{ color: look.color }}>{label}</ThemedText>
  </View>;
}

const stripDot = (name: string) => name.replace(/\.+$/, '');

export function TransferRouteRow({ item, accountLabel, palette, onPress, first }: {
  item: TransferListItem; accountLabel: (id: string) => string; palette: BandPalette; onPress: () => void; first: boolean;
}) {
  const words = transferActivityCopy(useLanguage());
  const large = useLargeTextLayout();
  const slate = useBand('accounts').tint;
  const ledgerMoney = useLedgerMoney();
  const named = (end: RouteEnd) => end.kind === 'account' ? accountLabel(end.accountId)
    : end.kind === 'party' ? end.name : words.route.unknown;
  const shown = (end: RouteEnd) => end.kind === 'unknown' ? '?' : named(end);
  const tag = item.tag === 'own' ? words.tags.own : item.tag === 'external' ? words.tags.external
    : item.tag === 'needs-answer' ? words.tags.needsAnswer : words.tags.unconfirmed;
  // Own transfers move money between the person's accounts and are not signed;
  // everything else reads by direction, the same as the question card.
  const sign = item.tag === 'own' || item.direction === 'between' ? 'none' : item.direction === 'out' ? 'minus' : 'plus';
  const directionWord = item.direction === 'out' ? words.outgoing : item.direction === 'in' ? words.incoming : words.own;
  const amountWord = `${ledgerMoney?.currency ?? ledgerCurrencyDisplay()} ${formatAmount(item.amountFils, { decimals: true })}`;
  const label = [`${stripDot(named(item.from))} ${words.route.to} ${stripDot(named(item.to))}`, directionWord, amountWord,
    shortDate(item.date), tag].join('. ');
  return <Pressable testID={`transfer-row-${item.key}`} accessibilityRole="button" accessibilityLabel={label}
    onPress={onPress}
    style={({ pressed }) => [styles.row, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.rule },
      { opacity: pressed ? 0.7 : 1 }]}>
    <View testID={`transfer-route-${item.key}`} style={large ? styles.routeLarge : styles.route}>
      <Chip end={item.from} label={shown(item.from)} palette={palette} large={large} />
      {/* Icon mirrors the chevron in Arabic itself; stacked, the route reads downward. */}
      <Icon name={large ? 'arrow-down' : 'chevron-right'} size={14} color={palette.textSecondary} />
      <Chip end={item.to} label={shown(item.to)} palette={palette} large={large} />
      <View style={large ? undefined : styles.amount}>
        <Money fils={item.amountFils} sign={sign} type="smallBold" decimals />
      </View>
    </View>
    <View style={styles.meta}>
      <ThemedText type="meta" style={{ color: palette.textSecondary }}>{shortDate(item.date)}</ThemedText>
      <Tag tag={item.tag} label={tag} palette={palette} slate={slate} />
    </View>
  </Pressable>;
}

const styles = StyleSheet.create({
  row: { minHeight: 64, paddingVertical: Spacing.three, gap: Spacing.one },
  route: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, flexWrap: 'wrap' },
  routeLarge: { flexDirection: 'column', alignItems: 'flex-start', gap: Spacing.one },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 10, paddingVertical: 3, paddingStart: 3, paddingEnd: 8 },
  chipCapped: { maxWidth: '42%' },
  initials: { width: 22, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  unknownMark: { paddingHorizontal: 8 },
  chipText: { flexShrink: 1 },
  amount: { marginStart: 'auto' },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  tag: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
});
