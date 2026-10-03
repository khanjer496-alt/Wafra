import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { merchantLogoFor } from '@/components/ui/merchant-logo-assets';
import { isWidgetLogoId } from '@/lib/widget-logo';
import { Icon } from '@/components/ui/icon';
import { Fonts, type BandPalette } from '@/constants/theme';
import {
  widgetAmountParts, widgetBillAmount, widgetBillTitle, widgetDueLabel, widgetInitial, widgetMoneyText,
  widgetTodayLine, widgetUpcomingBills, widgetWeekTotal,
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
 */

const SIZE = 164;
const TEXT_SCALE = 1.3;

export function TodayWidgetPreview({ snapshot, palette, words, testID }: {
  snapshot: WidgetSnapshot | null;
  palette: BandPalette;
  words: WidgetsCopy;
  testID?: string;
}) {
  const parts = snapshot ? widgetAmountParts(snapshot.todayMinor, snapshot) : null;
  const week = snapshot ? widgetMoneyText(widgetWeekTotal(snapshot), snapshot) : null;
  const line = snapshot ? widgetTodayLine(snapshot, words) : null;
  const spoken = snapshot
    ? [words.previewLabel(words.todayName), words.widgetToday,
      parts ? widgetMoneyText(snapshot.todayMinor, snapshot) : words.widgetAmountHidden, words.widgetLast7Total, week === '—' ? words.widgetAmountHidden : week, line].join('. ')
    : [words.previewLabel(words.todayName), words.widgetToday, words.widgetOpenToUpdate].join('. ');
  return <View testID={testID} accessible accessibilityRole="image" accessibilityLabel={spoken}
    style={[styles.small, { backgroundColor: palette.band }]}>
    {snapshot ? <>
      <View style={styles.week}>
        <ThemedText type="meta" numberOfLines={1} maxFontSizeMultiplier={TEXT_SCALE}
          style={[styles.label, { color: palette.onBandSecondary }]}>{words.widgetLast7Total}</ThemedText>
        <ThemedText testID={testID ? `${testID}-week-total` : undefined} type="smallBold" numberOfLines={1} adjustsFontSizeToFit
          maxFontSizeMultiplier={TEXT_SCALE} style={[styles.weekTotal, { color: palette.onBand }]}>{week}</ThemedText>
      </View>
      <View style={styles.grow} />
      <ThemedText type="meta" numberOfLines={1} maxFontSizeMultiplier={TEXT_SCALE}
        style={[styles.label, { color: palette.onBandSecondary }]}>{words.widgetToday}</ThemedText>
      <ThemedText testID={testID ? `${testID}-amount` : undefined} numberOfLines={1} adjustsFontSizeToFit
        maxFontSizeMultiplier={TEXT_SCALE} style={[styles.figure, { color: palette.onBand }]}>
        {parts ? <>
          <ThemedText style={[styles.currency, { color: palette.onBandSecondary }]}>{`\u200E${parts.currency} `}</ThemedText>
          {`${parts.number}\u200E`}
        </> : '—'}
      </ThemedText>
      <ThemedText testID={testID ? `${testID}-line` : undefined} type="meta" numberOfLines={2}
        maxFontSizeMultiplier={TEXT_SCALE} style={[styles.label, { color: palette.onBandSecondary }]}>{line}</ThemedText>
    </> : <>
      <ThemedText type="meta" maxFontSizeMultiplier={TEXT_SCALE}
        style={[styles.label, { color: palette.onBandSecondary }]}>{words.widgetToday}</ThemedText>
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
    ...(empty ? [empty] : rows.map((row) => `${row.spokenTitle}, ${row.due}, ${row.amount === '—' ? words.widgetAmountHidden : row.amount}`))].join('. ');
  return <View testID={testID} accessible accessibilityRole="image" accessibilityLabel={spoken}
    style={[styles.medium, { backgroundColor: palette.band }]}>
    <ThemedText type="smallBold" numberOfLines={1} maxFontSizeMultiplier={TEXT_SCALE}
      style={[styles.upcomingLabel, { color: palette.onBand }]}>{words.widgetComingUp}</ThemedText>
    {empty ? <View style={styles.emptyWrap}>
      <ThemedText type="smallBold" maxFontSizeMultiplier={TEXT_SCALE} style={{ color: palette.onBand }}>{empty}</ThemedText>
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
          <ThemedText type="meta" numberOfLines={1} maxFontSizeMultiplier={TEXT_SCALE}
            style={[styles.label, { color: palette.onBandSecondary }]}>{row.due}</ThemedText>
        </View>
        <ThemedText numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={TEXT_SCALE}
          style={[styles.rowAmount, { color: palette.onBand }]}>{row.amount}</ThemedText>
      </View>)}
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  grow: { flex: 1, minHeight: 6 },
  small: { width: SIZE, minHeight: SIZE, borderRadius: 24, padding: 16 },
  medium: { width: '100%', maxWidth: 360, minHeight: SIZE, borderRadius: 24, padding: 16 },
  week: { gap: 2 },
  label: { fontSize: 12, lineHeight: 16 },
  weekTotal: { fontSize: 13, lineHeight: 17, fontVariant: ['tabular-nums'] },
  logo: { width: 22, height: 22 },
  figure: { fontFamily: Fonts.sansSemi, fontSize: 28, lineHeight: 34, letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
  currency: { fontFamily: Fonts.sansMedium, fontSize: 17, letterSpacing: 0 },
  upcomingLabel: { fontSize: 12, lineHeight: 16, marginBottom: 8 },
  emptyWrap: { flex: 1, justifyContent: 'center' },
  rows: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tile: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  initial: { fontSize: 14, lineHeight: 18 },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 13, lineHeight: 17 },
  rowAmount: { fontFamily: Fonts.sansSemi, fontSize: 13, lineHeight: 17, fontVariant: ['tabular-nums'], flexShrink: 0, maxWidth: '45%' },
});
