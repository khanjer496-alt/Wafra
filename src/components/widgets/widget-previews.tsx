import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { merchantLogoFor } from '@/components/ui/merchant-logo-assets';
import { isWidgetLogoId } from '@/lib/widget-logo';
import { Icon } from '@/components/ui/icon';
import { Fonts, type BandPalette } from '@/constants/theme';
import {
  widgetAmountParts, widgetBillAmount, widgetBillsTotal, widgetBillTitle, widgetBudgetProgress, widgetDueLabel, widgetInitial,
  widgetMoneyText, widgetSpendingView, widgetTodayLine, widgetUpcomingBills, widgetWeekShares, widgetWeekTotal, widgetWholeMoney,
  WIDGET_SEGMENT_REST_ALPHA,
} from '@/lib/widget-preview';
import type { WidgetSnapshot } from '@/lib/widget-snapshot';
import type { WidgetsCopy } from '@/lib/widgets-copy';

/**
 * The two native widgets drawn in React Native from the snapshot they are
 * given right now (src/lib/widget-ledger.ts builds it exactly as Home does
 * for the real widgets). Today wears Home's ink band, Coming up Bills'
 * ochre band, in the app's light or dark scheme (the widgets themselves
 * follow the phone's appearance). No figure here is typed in: with no snapshot,
 * each preview shows the widget's own "Open Wafra to update" state.
 *
 * Each preview is one image to a screen reader, with the words the widget
 * shows spoken in order.
 *
 * Type follows the native widgets (WafraWidgetViews.swift, the Android
 * layouts): 12/16 labels and second lines in sentence case, a 13 seven-day
 * total, a 28 figure with its currency code at 17, and 16 of padding.
 *
 * Shapes follow them too: Today's seven bars (today in the band accent, a
 * zero day a thin baseline), its budget bar, and a corner of three pattern
 * shapes; Coming up's due pills; Spending's share bar. The shapes are plain
 * views, so they need no graphics library and read the same everywhere.
 */

const SIZE = 164;
const TEXT_SCALE = 1.3;

/** Today's seven bars, oldest first: today in the accent, the rest in the band's mark tone. */
function WeekBars({ snapshot, palette }: { snapshot: WidgetSnapshot; palette: BandPalette }) {
  const shares = widgetWeekShares(snapshot);
  return <View style={styles.bars}>
    {shares.map((share, index) => {
      const today = index === shares.length - 1;
      // A day with nothing (or a hidden one) is a thin baseline, never a bar.
      const height = share > 0 ? Math.max(4, Math.round(share * BAR_HEIGHT)) : BASELINE;
      return <View key={index} style={[styles.bar, { height,
        backgroundColor: today && share > 0 ? palette.accent : palette.bandMark, opacity: share > 0 ? 1 : 0.6 }]} />;
    })}
  </View>;
}

/** Three of the pattern's shapes, small, in the band's own tones. */
function PatternCorner({ palette }: { palette: BandPalette }) {
  return <View style={styles.pattern}>
    <View style={[styles.quarter, { backgroundColor: palette.tile }]} />
    <View style={[styles.ring, { borderColor: palette.bandMark }]} />
    <View style={[styles.dot, { backgroundColor: palette.accent }]} />
  </View>;
}

export function TodayWidgetPreview({ snapshot, palette, words, testID }: {
  snapshot: WidgetSnapshot | null;
  palette: BandPalette;
  words: WidgetsCopy;
  testID?: string;
}) {
  const parts = snapshot ? widgetAmountParts(snapshot.todayMinor, snapshot) : null;
  // The bars' label: whole units so it holds one line; spoken exactly.
  const week = snapshot ? widgetMoneyText(widgetWeekTotal(snapshot), snapshot) : null;
  const weekShown = snapshot ? widgetWholeMoney(widgetWeekTotal(snapshot), snapshot) : null;
  const line = snapshot ? widgetTodayLine(snapshot, words) : null;
  const progress = snapshot ? widgetBudgetProgress(snapshot) : null;
  const spoken = snapshot
    ? [words.previewLabel(words.todayName), words.widgetToday,
      parts ? widgetMoneyText(snapshot.todayMinor, snapshot) : words.widgetAmountHidden, words.widgetLast7Total, week === '—' ? words.widgetAmountHidden : week, line].join('. ')
    : [words.previewLabel(words.todayName), words.widgetToday, words.widgetOpenToUpdate].join('. ');
  return <View testID={testID} accessible accessibilityRole="image" accessibilityLabel={spoken}
    style={[styles.small, { backgroundColor: palette.band }]}>
    {snapshot ? <>
      {/* The label and, in the corner, the pattern; then the bars it names
          and their total in whole units. */}
      <View style={styles.topRow}>
        <ThemedText type="meta" numberOfLines={1} maxFontSizeMultiplier={TEXT_SCALE}
          style={[styles.label, styles.shrink, { color: palette.onBandSecondary }]}>{words.widgetLast7Total}</ThemedText>
        <PatternCorner palette={palette} />
      </View>
      <View style={styles.weekRow}>
        <WeekBars snapshot={snapshot} palette={palette} />
        <ThemedText testID={testID ? `${testID}-week-total` : undefined} type="smallBold" numberOfLines={1} adjustsFontSizeToFit
          maxFontSizeMultiplier={TEXT_SCALE} style={[styles.weekTotal, { color: palette.onBand }]}>{weekShown}</ThemedText>
      </View>
      <View style={styles.grow} />
      <ThemedText type="meta" numberOfLines={1} maxFontSizeMultiplier={TEXT_SCALE}
        style={[styles.label, { color: palette.onBandSecondary }]}>{words.widgetToday}</ThemedText>
      <ThemedText testID={testID ? `${testID}-amount` : undefined} numberOfLines={1} adjustsFontSizeToFit
        maxFontSizeMultiplier={TEXT_SCALE} style={[styles.figure, { color: palette.onBand }]}>
        {parts ? <>
          <ThemedText style={[styles.currency, { color: palette.onBandSecondary }]}>{`‎${parts.currency} `}</ThemedText>
          {`${parts.number}‎`}
        </> : '—'}
      </ThemedText>
      {progress ? <View testID={testID ? `${testID}-budget-bar` : undefined} style={[styles.track, { backgroundColor: palette.tile }]}>
        <View style={[styles.fill, { width: `${Math.round(progress.fraction * 100)}%`,
          backgroundColor: progress.over ? palette.statusOver : palette.accent }]} />
      </View> : null}
      <ThemedText testID={testID ? `${testID}-line` : undefined} type="meta" numberOfLines={2}
        maxFontSizeMultiplier={TEXT_SCALE} style={[styles.label, { color: palette.onBandSecondary }]}>{line}</ThemedText>
    </> : <>
      <View style={styles.topRow}>
        <ThemedText type="meta" maxFontSizeMultiplier={TEXT_SCALE}
          style={[styles.label, { color: palette.onBandSecondary }]}>{words.widgetToday}</ThemedText>
        <PatternCorner palette={palette} />
      </View>
      <View style={styles.grow} />
      <ThemedText type="smallBold" maxFontSizeMultiplier={TEXT_SCALE} style={{ color: palette.onBand }}>{words.widgetOpenToUpdate}</ThemedText>
    </>}
  </View>;
}

export function UpcomingWidgetPreview({ snapshot, palette, words, testID }: {
  snapshot: WidgetSnapshot | null;
  palette: BandPalette;
  words: WidgetsCopy;
  /** Both platforms draw Coming up alike; kept for callers. */
  platform?: 'ios' | 'android';
  testID?: string;
}) {
  const bills = snapshot ? widgetUpcomingBills(snapshot) : [];
  const total = snapshot ? widgetBillsTotal(bills, snapshot) : null;
  const rows = snapshot ? bills.map((bill) => ({
    key: `${bill.dueISO}:${bill.title}`,
    title: widgetBillTitle(bill, snapshot),
    spokenTitle: bill.title || '—',
    initial: widgetInitial(bill.title),
    logo: (() => {
      const id = isWidgetLogoId(bill.logoId) ? bill.logoId : null;
      const logo = merchantLogoFor(bill.title);
      return logo?.id === id ? logo : null;
    })(),
    due: widgetDueLabel(bill.dueISO, snapshot.todayISO, words),
    amount: widgetBillAmount(bill, snapshot),
  })) : [];
  const empty = !snapshot ? words.widgetOpenToUpdate : rows.length === 0 ? words.widgetNothingComingUp : null;
  const spoken = [words.previewLabel(words.upcomingName), words.widgetComingUp,
    ...(total ? [words.widgetTotalDue(total)] : []),
    ...(empty ? [empty] : rows.map((row) => `${row.spokenTitle}, ${row.due}, ${row.amount === '—' ? words.widgetAmountHidden : row.amount}`))].join('. ');
  return <View testID={testID} accessible accessibilityRole="image" accessibilityLabel={spoken}
    style={[styles.medium, { backgroundColor: palette.band }]}>
    <View style={styles.header}>
      <ThemedText type="smallBold" numberOfLines={1} maxFontSizeMultiplier={TEXT_SCALE}
        style={[styles.upcomingLabel, styles.shrink, { color: palette.onBand }]}>{words.widgetComingUp}</ThemedText>
      {total && !empty ? <ThemedText testID={testID ? `${testID}-total` : undefined} numberOfLines={1} adjustsFontSizeToFit
        maxFontSizeMultiplier={TEXT_SCALE} style={[styles.headerFigure, { color: palette.onBand }]}>{total}</ThemedText> : null}
    </View>
    {empty ? <View style={styles.emptyWrap}>
      {snapshot ? <Icon name="calendar" size={20} color={palette.onBand} /> : null}
      <ThemedText type="smallBold" maxFontSizeMultiplier={TEXT_SCALE}
        style={[styles.emptyText, { color: palette.onBand }]}>{empty}</ThemedText>
    </View> : <View style={styles.rows}>
      {rows.map((row) => <View key={row.key} style={styles.row}>
        <View style={[styles.tile, { backgroundColor: palette.tile }]}>
          {row.logo ? <Image source={row.logo.source} contentFit="contain" style={styles.logo}
            tintColor={row.logo.tint === 'theme' ? palette.onBand : row.logo.tint === 'dark' ? '#16130F' : undefined} /> : row.initial
            ? <ThemedText type="smallBold" maxFontSizeMultiplier={1} style={[styles.initial, { color: palette.onBand }]}>{row.initial}</ThemedText>
            : <Icon name="calendar" size={14} color={palette.onBand} />}
        </View>
        <View style={styles.rowCopy}>
          <ThemedText type="smallBold" numberOfLines={1} maxFontSizeMultiplier={TEXT_SCALE}
            style={[styles.rowTitle, { color: palette.onBand }]}>{row.title}</ThemedText>
          <View style={[styles.pill, { backgroundColor: palette.tile }]}>
            <ThemedText type="meta" numberOfLines={1} maxFontSizeMultiplier={TEXT_SCALE}
              style={[styles.pillText, { color: palette.onBand }]}>{row.due}</ThemedText>
          </View>
        </View>
        <ThemedText numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={TEXT_SCALE}
          style={[styles.rowAmount, { color: palette.onBand }]}>{row.amount}</ThemedText>
      </View>)}
    </View>}
  </View>;
}

/**
 * Spending this month on the Spending band: the month and its total, a share
 * bar of the categories (three named in falling strength, the rest quiet),
 * and the three largest with whole-unit amounts, as the design draws it.
 */
export function SpendingWidgetPreview({ snapshot, palette, words, testID }: {
  snapshot: WidgetSnapshot | null;
  palette: BandPalette;
  words: WidgetsCopy;
  testID?: string;
}) {
  const view = snapshot ? widgetSpendingView(snapshot, words) : null;
  const empty = !view ? words.widgetOpenToUpdate : view.top.length === 0 ? words.widgetSpendingEmpty : null;
  const spoken = [words.previewLabel(words.spendingName),
    ...(view ? [view.month, view.total ?? words.widgetAmountHidden] : []),
    ...(empty ? [empty] : view!.top.map((row) => row.amount ? `${row.label} ${row.amount}` : row.label))].join('. ');
  return <View testID={testID} accessible accessibilityRole="image" accessibilityLabel={spoken}
    style={[styles.medium, { backgroundColor: palette.band }]}>
    <View style={styles.header}>
      <ThemedText type="smallBold" numberOfLines={1} maxFontSizeMultiplier={TEXT_SCALE}
        style={[styles.spendingMonth, styles.shrink, { color: palette.onBand }]}>{view?.month ?? words.spendingName}</ThemedText>
      {view?.total && !empty ? <ThemedText testID={testID ? `${testID}-total` : undefined} numberOfLines={1}
        maxFontSizeMultiplier={TEXT_SCALE} style={[styles.spendingTotal, { color: palette.onBand }]}>{view.total}</ThemedText> : null}
    </View>
    {empty ? <View style={styles.emptyWrap}>
      <ThemedText type="smallBold" maxFontSizeMultiplier={TEXT_SCALE}
        style={[styles.emptyText, { color: palette.onBand }]}>{empty}</ThemedText>
    </View> : <>
      <View testID={testID ? `${testID}-bar` : undefined} style={styles.shareBar}>
        {(view!.segments.length > 0 ? view!.segments : [{ share: 1, alpha: WIDGET_SEGMENT_REST_ALPHA }]).map((segment, index) =>
          <View key={index} style={[styles.segment, { flex: segment.share, backgroundColor: palette.onBand, opacity: segment.alpha }]} />)}
      </View>
      <View style={styles.topCategories}>
        {view!.top.map((row) => <ThemedText key={row.label} type="meta" numberOfLines={1} maxFontSizeMultiplier={TEXT_SCALE}
          style={[styles.label, styles.shrink, styles.topCategory, { color: palette.onBand }]}>
          {row.amount ? `${row.label} ⁦${row.amount}⁩` : row.label}
        </ThemedText>)}
      </View>
    </>}
  </View>;
}

const BAR_HEIGHT = 22;
const BASELINE = 2;

const styles = StyleSheet.create({
  grow: { flex: 1, minHeight: 6 },
  shrink: { flexShrink: 1, minWidth: 0 },
  small: { width: SIZE, minHeight: SIZE, borderRadius: 24, padding: 16 },
  medium: { width: '100%', maxWidth: 360, minHeight: SIZE, borderRadius: 24, padding: 16 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  bars: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: BAR_HEIGHT, maxWidth: 84 },
  bar: { flex: 1, borderRadius: 2 },
  pattern: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, flexShrink: 0 },
  quarter: { width: 12, height: 12, borderTopLeftRadius: 12 },
  ring: { width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  dot: { width: 5, height: 5, borderRadius: 2.5, marginBottom: 2 },
  weekRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8, marginTop: 4 },
  label: { fontSize: 12, lineHeight: 16 },
  weekTotal: { fontSize: 13, lineHeight: 17, fontVariant: ['tabular-nums'], flexShrink: 0 },
  logo: { width: 22, height: 22 },
  figure: { fontFamily: Fonts.sansSemi, fontSize: 28, lineHeight: 34, letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
  currency: { fontFamily: Fonts.sansMedium, fontSize: 17, letterSpacing: 0 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 2, marginBottom: 4 },
  fill: { height: 4, borderRadius: 2 },
  header: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 8 },
  upcomingLabel: { fontSize: 12, lineHeight: 16 },
  headerFigure: { fontFamily: Fonts.sansSemi, fontSize: 12, lineHeight: 16, fontVariant: ['tabular-nums'], flexShrink: 0, maxWidth: '60%' },
  emptyWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 6 },
  emptyText: { textAlign: 'center' },
  rows: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tile: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  initial: { fontSize: 14, lineHeight: 18 },
  rowCopy: { flex: 1, minWidth: 0, alignItems: 'flex-start', gap: 2 },
  rowTitle: { fontSize: 13, lineHeight: 17 },
  pill: { borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1 },
  pillText: { fontSize: 11, lineHeight: 15 },
  rowAmount: { fontFamily: Fonts.sansSemi, fontSize: 13, lineHeight: 17, fontVariant: ['tabular-nums'], flexShrink: 0, maxWidth: '45%' },
  spendingMonth: { fontSize: 13, lineHeight: 18 },
  spendingTotal: { fontFamily: Fonts.sansMedium, fontSize: 13, lineHeight: 18, fontVariant: ['tabular-nums'], flexShrink: 0 },
  shareBar: { flexDirection: 'row', gap: 3, height: 26, marginTop: 6 },
  segment: { height: 26, borderRadius: 6, minWidth: 3 },
  topCategories: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginTop: 12 },
  topCategory: { opacity: 0.9 },
});
