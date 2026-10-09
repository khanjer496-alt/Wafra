/**
 * Home v3's transactions: the latest rows of the period, grouped by day under
 * a quiet day label (no repeated day totals), and "See all" to the full list.
 * Each row is one tap target that opens the transaction's detail sheet; the
 * merchant page is reached from inside the sheet.
 *
 * Motion: a capture that arrives while Home is open lands at the top with the
 * screen's arrival (`Arriving`, the coin drop). On the first open of a session
 * the rows also settle in one after another, on one native-driven clock;
 * later opens draw them in place. Reduce Motion or a screen reader: in place.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { TransactionRow } from '@/components/transaction-row';
import { COIN_MOVE_CURVE, COIN_STAGGER, coinTrack, useCoinClock, useCoinRun, type CoinNode, type CoinRun } from '@/components/ui/coins/coin-motion';
import { Icon } from '@/components/ui/icon';
import { Fonts, type BandPalette } from '@/constants/theme';
import { useAppActive } from '@/hooks/use-app-active';
import { useMotionPreference } from '@/hooks/use-reduced-motion';
import { friendlyDate } from '@/lib/format';
import type { Account, Transaction } from '@/lib/types';

/** The session's first open settles the rows in; every later open draws them in place. */
let settledThisSession = false;

/** Recent rows grouped by their date, newest first, in display order. */
export function recentDays(rows: readonly Transaction[]): { date: string; rows: Transaction[] }[] {
  const days: { date: string; rows: Transaction[] }[] = [];
  for (const row of rows) {
    const last = days.at(-1);
    if (last && last.date === row.date) last.rows.push(row);
    else days.push({ date: row.date, rows: [row] });
  }
  return days;
}

export function HomeRecent({ rows, accountById, internalIds, onPress, arrivedRowId, Arriving, hold, todayISO, band,
  title, seeAll, seeAllHint, onSeeAll, note, empty, footer }: {
  rows: readonly Transaction[];
  accountById: ReadonlyMap<string, Account>;
  internalIds: ReadonlySet<string>;
  onPress: (transaction: Transaction) => void;
  /** The row that arrived while Home was open, if any. */
  arrivedRowId: string | null;
  Arriving: React.ComponentType<{ children: React.ReactNode; hold?: boolean }>;
  hold: boolean;
  todayISO: string;
  band: BandPalette;
  title: string;
  seeAll: string;
  seeAllHint: string;
  onSeeAll: () => void;
  /** The period, named when it is not the running month (the rows are that period's). */
  note?: string;
  /** Drawn instead of the rows when the period has none. */
  empty?: React.ReactNode;
  /** A quiet line under the rows (transfers waiting that the Needs you pill does not name). */
  footer?: React.ReactNode;
}) {
  const motion = useMotionPreference();
  const active = useAppActive();
  const live = motion.ready && active && !hold;
  const days = useMemo(() => recentDays(rows), [rows]);
  const count = rows.length;
  const clock = useCoinClock();
  const settle = useMemo((): { rows: CoinNode[]; run: CoinRun | null; held: boolean } => {
    const still = (value: number) => Array.from({ length: count }, () => new Animated.Value(value));
    if (motion.reducedMotion || settledThisSession || count === 0) return { rows: still(1), run: null, held: false };
    if (!live) return { rows: still(0), run: null, held: true };
    const run = clock.reserve((count - 1) * COIN_STAGGER + COIN_MOVE_CURVE.restMs);
    return {
      rows: Array.from({ length: count }, (_, index) => coinTrack(clock.value, run.base, 1,
        [{ at: index * COIN_STAGGER, from: 0, to: 1, curve: COIN_MOVE_CURVE }])),
      run, held: false,
    };
    // Planned once for the rows Home opened with; `settledThisSession` is read, never a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock, live, motion.reducedMotion, count > 0]);
  const landed = useRef(false);
  useEffect(() => {
    if (!settle.held && count > 0 && !landed.current) { landed.current = true; settledThisSession = true; }
  }, [settle, count]);
  useCoinRun(clock, settle.run, live);
  // Built once per plan, so a re-render does not rebuild the rows' native nodes.
  const paints = useMemo(() => settle.rows.map((node) => ({
    opacity: node.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
    transform: [{ translateY: node.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
  })), [settle]);
  // A row added after the plan (a later capture) shares the last row's track: at rest, in place.
  const paint = (at: number) => paints[Math.min(at, paints.length - 1)] ?? null;
  let index = 0;
  // A heading over nothing says nothing: with no rows, no empty state and no
  // footer, the section is left out.
  if (count === 0 && !empty && !footer) return null;
  return <View style={styles.section} testID="home-widget-activity">
    <View style={styles.heading}>
      <View style={styles.grow}>
        <ThemedText type="smallBold" accessibilityRole="header" style={styles.title}>{title}</ThemedText>
        {note ? <ThemedText testID="home-activity-period" type="meta" style={{ color: band.textSecondary }}>{note}</ThemedText> : null}
      </View>
      <Pressable testID="home-see-all" onPress={onSeeAll} accessibilityRole="button" accessibilityLabel={seeAll}
        accessibilityHint={seeAllHint} style={({ pressed }) => [styles.seeAll, { opacity: pressed ? 0.6 : 1 }]}>
        <ThemedText type="smallBold" style={{ color: band.tint }}>{seeAll}</ThemedText>
        <Icon name="chevron-right" size={16} color={band.tint} />
      </Pressable>
    </View>
    {/* With no rows, the empty state (or the way to Transfers) stands in for the footer. */}
    {count === 0 ? empty ?? footer ?? null : days.map((day) => {
      const first = index;
      return <View key={day.date} testID={`home-activity-day-${day.date}`}>
        <Animated.View style={paint(first)}>
          <ThemedText type="meta" accessibilityRole="header" style={[styles.day, { color: band.textSecondary }]}>
            {friendlyDate(day.date, todayISO)}</ThemedText>
        </Animated.View>
        {day.rows.map((transaction) => {
          const at = index++;
          const row = <TransactionRow transaction={transaction} account={accountById.get(transaction.accountId)} onPress={onPress}
            internal={internalIds.has(transaction.id)} merchantLinks={false} testID="transaction-details-link" />;
          // The row that just arrived carries the arrival; the first open settles the rest.
          return transaction.id === arrivedRowId
            ? <Arriving key={transaction.id} hold={hold}>{row}</Arriving>
            : <Animated.View key={transaction.id} style={paint(at)}>{row}</Animated.View>;
        })}
      </View>;
    })}
    {count > 0 ? footer ?? null : null}
  </View>;
}

const styles = StyleSheet.create({
  section: { paddingTop: 2 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  grow: { flex: 1, minWidth: 0 },
  title: { fontSize: 20, lineHeight: 26 },
  seeAll: { minHeight: 44, minWidth: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  day: { fontFamily: Fonts.sansSemi, paddingTop: 12, paddingBottom: 2 },
});
