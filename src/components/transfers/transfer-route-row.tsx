import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { Spacing, type BandPalette } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { shortDate } from '@/lib/format';
import { transferActivityCopy } from '@/lib/transfer-activity-copy';
import type { RouteEnd, TransferListItem } from '@/lib/transfer-list';

function Chip({ end, label, palette }: { end: RouteEnd; label: string; palette: BandPalette }) {
  const initials = label.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();
  return <View style={[styles.chip, end.kind === 'unknown'
    ? { borderStyle: 'dashed', borderWidth: 1, borderColor: palette.textSecondary }
    : { backgroundColor: palette.glyphGround }]}>
    {end.kind !== 'unknown' ? <View style={[styles.initials, { backgroundColor: palette.fill }]}>
      <ThemedText type="micro" style={{ color: palette.onFill }}>{initials}</ThemedText>
    </View> : null}
    <ThemedText type="smallBold" numberOfLines={1} style={styles.chipText}>{label}</ThemedText>
  </View>;
}

export function TransferRouteRow({ item, accountLabel, palette, onPress, first }: {
  item: TransferListItem; accountLabel: (id: string) => string; palette: BandPalette; onPress: () => void; first: boolean;
}) {
  const words = transferActivityCopy(useLanguage());
  const large = useLargeTextLayout();
  const label = (end: RouteEnd) => end.kind === 'account' ? accountLabel(end.accountId)
    : end.kind === 'party' ? end.name : words.route.unknown;
  const tag = item.tag === 'own' ? words.tags.own : item.tag === 'external' ? words.tags.external
    : item.tag === 'needs-answer' ? words.tags.needsAnswer : words.tags.unconfirmed;
  const tagColor = item.tag === 'needs-answer' ? palette.statusNear : palette.textSecondary;
  const sign = item.direction === 'out' && item.tag === 'external' ? 'minus' : item.direction === 'in' && item.tag === 'external' ? 'plus' : 'none';
  return <Pressable testID={`transfer-row-${item.key}`} accessibilityRole="button"
    accessibilityLabel={`${label(item.from)} ${words.route.to} ${label(item.to)}. ${shortDate(item.date)}. ${tag}`}
    onPress={onPress}
    style={({ pressed }) => [styles.row, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.rule },
      { opacity: pressed ? 0.7 : 1 }]}>
    <View style={[styles.route, large && styles.routeStack]}>
      <Chip end={item.from} label={label(item.from)} palette={palette} />
      {/* Icon mirrors this one in Arabic itself. */}
      <Icon name="chevron-right" size={14} color={palette.textSecondary} />
      <Chip end={item.to} label={label(item.to)} palette={palette} />
      <View style={styles.amount}><Money fils={item.amountFils} sign={sign} type="smallBold" decimals /></View>
    </View>
    <ThemedText type="meta" style={{ color: palette.textSecondary }}>
      {shortDate(item.date)} · <ThemedText type="meta" style={{ color: tagColor }}>{tag}</ThemedText>
    </ThemedText>
  </Pressable>;
}

const styles = StyleSheet.create({
  row: { minHeight: 64, paddingVertical: Spacing.three, gap: Spacing.one },
  route: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, flexWrap: 'wrap' },
  routeStack: { alignItems: 'flex-start' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 10, paddingVertical: 3, paddingStart: 3, paddingEnd: 8, maxWidth: '42%' },
  initials: { width: 22, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  chipText: { flexShrink: 1 },
  amount: { marginStart: 'auto' },
});
