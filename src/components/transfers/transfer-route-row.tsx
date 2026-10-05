import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import type { CoinCue } from '@/components/transfer-coins/coin-cues';
import { RouteCoinLane } from '@/components/transfer-coins/route-coin';
import { SelectionMark } from '@/components/transfers/transfer-select-mark';
import { Money } from '@/components/ui/money';
import { Spacing, type BandPalette } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useLedgerMoney } from '@/hooks/use-ledger-money';
import { formatAmount, shortDateWithYear } from '@/lib/format';
import { ledgerCurrencyDisplay } from '@/lib/markets';
import { transferActivityCopy } from '@/lib/transfer-activity-copy';
import type { RouteEnd, TransferListItem } from '@/lib/transfer-list';

const firstLetter = (part: string) => Array.from(part)[0] ?? '';
/** Words that open with punctuation ("·", "••4410") are separators and masked digits, not names. */
const isNamePart = (part: string) => !/^\p{P}/u.test(part);

/**
 * One end of a route: initials on the band fill and the name, or a dashed "?" for an unknown side.
 * An unknown side the person has answered is no longer a question: it reads "Your account" (own,
 * in the own tag's slate) or "Someone else" (in the counted tag's gold), with an icon instead of initials.
 */
export function RouteChip({ end, label, palette, large, answered, slate, direction }: {
  end: RouteEnd; label: string; palette: BandPalette; large: boolean;
  answered?: 'own' | 'external'; slate?: string; direction?: TransferListItem['direction'];
}) {
  const words = label.split(/\s+/).filter(Boolean);
  const initials = (words.some(isNamePart) ? words.filter(isNamePart) : words).map(firstLetter).slice(0, 2).join('').toUpperCase();
  const unknown = end.kind === 'unknown';
  if (unknown && answered) {
    const own = answered === 'own';
    const ink = own ? slate ?? palette.text : palette.statusNear;
    // An answer is short and is the point of the row: it is never capped or cut ("Someone el…").
    // It keeps its width; the account chip beside it yields, and the row wraps when both cannot fit.
    return <View testID="transfer-route-answered" style={[styles.chip, styles.answeredChip,
      { backgroundColor: own ? palette.glyphGround : palette.statusNearSoft }]}>
      <View style={styles.answeredIcon}>
        <Icon name={own ? 'wallet' : direction === 'in' ? 'arrow-down-right' : 'arrow-up-right'} size={14} color={ink} />
      </View>
      <ThemedText type="smallBold" style={{ color: ink }}>{label}</ThemedText>
    </View>;
  }
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
export function RouteTag({ tag, label, palette, slate }: { tag: TransferListItem['tag']; label: string; palette: BandPalette; slate: string }) {
  const look = tag === 'own' ? { backgroundColor: palette.glyphGround, color: slate }
    : tag === 'external' ? { backgroundColor: palette.statusNearSoft, color: palette.statusNear }
      : tag === 'needs-answer' ? { backgroundColor: palette.statusNear, color: palette.sheet }
        : { backgroundColor: 'transparent', color: palette.textSecondary };
  return <View style={[styles.tag, { backgroundColor: look.backgroundColor }]}>
    <ThemedText type="meta" style={{ color: look.color }}>{label}</ThemedText>
  </View>;
}

const stripDot = (name: string) => name.replace(/\.+$/, '');

/**
 * The route itself: the From chip, the line a coin travels (decorative, see
 * RouteCoinLane), the To chip and the amount. Stacks downward at large text and
 * mirrors in Arabic. The Transfers list and the transfer review screen both
 * draw transfers with it; the caller names the whole row for screen readers.
 */
export function TransferRoute({ from, to, fromLabel, toLabel, amountFils, sign, palette, coin, testID, laneTestID, answered, slate, direction, full }: {
  from: RouteEnd; to: RouteEnd; fromLabel: string; toLabel: string; amountFils: number;
  /** In a sheet: every name is shown whole (chips wrap instead of truncating), as the details it is. */
  full?: boolean;
  sign: 'none' | 'minus' | 'plus'; palette: BandPalette; coin?: CoinCue; testID?: string; laneTestID?: string;
  /** How an unknown end was answered, so it is drawn as the answer rather than a "?". */
  answered?: 'own' | 'external'; slate?: string; direction?: TransferListItem['direction'];
}) {
  const language = useLanguage();
  const large = useLargeTextLayout();
  return <View testID={testID} style={large ? styles.routeLarge : styles.route}>
    <RouteChip end={from} label={fromLabel} palette={palette} large={large || !!full} answered={answered} slate={slate} direction={direction} />
    {/* The line from one end to the other, where a coin travels; stacked, the route reads downward. */}
    <RouteCoinLane cue={coin} stacked={large} rtl={language === 'ar'} palette={palette} testID={laneTestID} />
    <RouteChip end={to} label={toLabel} palette={palette} large={large || !!full} answered={answered} slate={slate} direction={direction} />
    <View style={large ? undefined : styles.amount}>
      <Money fils={amountFils} sign={sign} type="smallBold" decimals />
    </View>
  </View>;
}

export function TransferRouteRow({ item, accountLabel, palette, onPress, first, coin, select }: {
  item: TransferListItem; accountLabel: (id: string) => string; palette: BandPalette; onPress: () => void; first: boolean;
  /** When given and fresh, a coin travels this route once (see transfer-coins/coin-cues). */
  coin?: CoinCue;
  /** Select mode: the row is a checkbox and carries its tick box. */
  select?: { checked: boolean; disabled?: boolean };
}) {
  const language = useLanguage();
  const words = transferActivityCopy(language);
  const slate = useBand('accounts').tint;
  const ledgerMoney = useLedgerMoney();
  // Answered, an unknown end says what the person told us; only an open question shows "?".
  const answered = item.tag === 'own' ? 'own' as const : item.tag === 'external' ? 'external' as const : undefined;
  const named = (end: RouteEnd) => end.kind === 'account' ? accountLabel(end.accountId)
    : end.kind === 'party' ? end.name
      : answered === 'own' ? words.route.yourAccount : answered === 'external' ? words.route.someoneElse : words.route.unknown;
  const shown = (end: RouteEnd) => end.kind === 'unknown' && !answered ? '?' : named(end);
  const tag = item.tag === 'own' ? words.tags.own : item.tag === 'external' ? words.tags.external
    : item.tag === 'needs-answer' ? words.tags.needsAnswer : words.tags.unconfirmed;
  // Own transfers move money between the person's accounts and are not signed;
  // everything else reads by direction, the same as the question card.
  const sign = item.tag === 'own' || item.direction === 'between' ? 'none' : item.direction === 'out' ? 'minus' : 'plus';
  const directionWord = item.direction === 'out' ? words.outgoing : item.direction === 'in' ? words.incoming : words.own;
  const amountWord = `${ledgerMoney?.currency ?? ledgerCurrencyDisplay()} ${formatAmount(item.amountFils, { decimals: true })}`;
  const label = [`${stripDot(named(item.from))} ${words.route.to} ${stripDot(named(item.to))}`, directionWord, amountWord,
    shortDateWithYear(item.date), tag].join('. ');
  const body = <>
    <TransferRoute from={item.from} to={item.to} fromLabel={shown(item.from)} toLabel={shown(item.to)}
      amountFils={item.amountFils} sign={sign} palette={palette} coin={coin} answered={answered} slate={slate}
      direction={item.direction} testID={`transfer-route-${item.key}`} laneTestID={`transfer-lane-${item.key}`} />
    <View style={styles.meta}>
      <ThemedText type="meta" style={{ color: palette.textSecondary }}>{shortDateWithYear(item.date)}</ThemedText>
      <RouteTag tag={item.tag} label={tag} palette={palette} slate={slate} />
    </View>
  </>;
  return <Pressable testID={`transfer-row-${item.key}`} accessibilityRole={select ? 'checkbox' : 'button'}
    accessibilityLabel={select ? `${words.select.item}. ${label}` : label}
    accessibilityState={select ? { checked: select.checked, disabled: !!select.disabled } : undefined}
    aria-checked={select ? select.checked : undefined} disabled={select?.disabled}
    onPress={onPress}
    style={({ pressed }) => [styles.row, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.rule },
      { opacity: pressed ? 0.7 : 1 }]}>
    {select ? <View style={styles.selectRow}>
      <SelectionMark checked={select.checked} palette={palette} />
      <View style={styles.selectBody}>{body}</View>
    </View> : body}
  </Pressable>;
}

const styles = StyleSheet.create({
  row: { minHeight: 64, paddingVertical: Spacing.three, gap: Spacing.one },
  route: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, flexWrap: 'wrap' },
  routeLarge: { flexDirection: 'column', alignItems: 'flex-start', gap: Spacing.one },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 10, paddingVertical: 3, paddingStart: 3, paddingEnd: 8, maxWidth: '100%' },
  chipCapped: { maxWidth: '42%', flexShrink: 1 },
  initials: { width: 22, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  unknownMark: { paddingHorizontal: 8 },
  answeredIcon: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  answeredChip: { flexShrink: 0, maxWidth: '100%' },
  chipText: { flexShrink: 1 },
  amount: { marginStart: 'auto' },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  selectRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  selectBody: { flex: 1, minWidth: 0, gap: Spacing.one },
  tag: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
});
