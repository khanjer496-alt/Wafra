import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  FadeInLeft,
  FadeInRight,
  FadeInUp,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { BandFigure } from '@/components/ui/band/band-figure';
import { EButton } from '@/components/ui/band/e-button';
import { StatTile } from '@/components/ui/band/stat-tile';
import { BAND_GUTTER, BandIconButton } from '@/components/ui/band-scaffold';
import { BankAvatar } from '@/components/ui/bank-avatar';
import { GrowBar } from '@/components/ui/grow-bar';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import { YourPattern } from '@/components/ui/your-pattern';
import { EASE, Fonts, Motion, bandPalette, type BandId, type BandPalette } from '@/constants/theme';
import { useBandScheme } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { monthLabel, shiftMonthKey, shortDate, weekdayName } from '@/lib/format';
import { formatMinorUnits, type LedgerMoneySpec } from '@/lib/ledger-money';
import { tapped } from '@/lib/haptics';
import { isRTL } from '@/lib/i18n';
import { recapWords, type RecapWords } from '@/lib/recap-copy';
import { RECAP_TIME_BUCKETS, type RecapSnapshot } from '@/lib/recap';

const STORY_MS = 7_000;

/**
 * Larger Text caps for the story's display type, following the iOS ramp
 * (Large Title grows 1.76x at the largest size while Body grows 3.1x). Body
 * copy and labels in the story are not capped.
 */
const STORY_TITLE_MAX = 1.75;
const STORY_TITLE_SMALL_MAX = 2;
const STORY_NUMERAL_MAX = 1.5;

/** Strength of the band's text colour per category rank on the share bar. */
const RANK_OPACITY = [0.92, 0.7, 0.5, 0.36, 0.28] as const;
const REST_OPACITY = 0.16;

type SceneKey = 'cover' | 'where' | 'category' | 'account' | 'rhythm' | 'highlight' | 'final';

/**
 * The band each card wears. The cover is the ink of Home (where the recap
 * opens from, and the only other place the personal pattern is drawn); "where
 * and when" is Spending's clay; the rest take the tab their subject lives in.
 */
export const RECAP_SCENE_BANDS: Record<SceneKey, BandId> = {
  cover: 'home',
  where: 'spending',
  category: 'bills',
  account: 'accounts',
  rhythm: 'flow',
  highlight: 'spending',
  final: 'home',
};

/**
 * The cards a snapshot has, in story order. A card is only there when the
 * period has what it shows: no invented merchant, account or time of day.
 */
export function recapScenes(snapshot: RecapSnapshot): SceneKey[] {
  const scenes: SceneKey[] = ['cover'];
  if (snapshot.topMerchants.length > 0) scenes.push('where');
  if (snapshot.topCategories.length > 0) scenes.push('category');
  if (snapshot.mostUsedAccount) scenes.push('account');
  if (snapshot.spendingCount > 0) scenes.push('rhythm');
  if (snapshot.descriptor.kind === 'year' || snapshot.largestPurchase) scenes.push('highlight');
  scenes.push('final');
  return scenes;
}

/** Match Wafra's app-wide policy: screen readers suppress motion too. */
function useRecapEntering() {
  const reducedMotion = useReducedMotion();
  return <T,>(animation: T): T | undefined => reducedMotion ? undefined : animation;
}

const moneyLabel = (fils: number, moneySpec: LedgerMoneySpec) =>
  `${moneySpec.currency} ${fils < 0 ? '−' : ''}${formatMinorUnits(Math.abs(fils), moneySpec)}`;

type SceneProps = { snapshot: RecapSnapshot; moneySpec: LedgerMoneySpec; palette: BandPalette; w: RecapWords; compact: boolean };

/** A row amount on a band: Geist Mono like every row amount in the app. */
function MoneyText({ fils, moneySpec, color }: { fils: number; moneySpec: LedgerMoneySpec; color: string }) {
  return <ThemedText type="smallBold" tabular style={{ color }}>{moneyLabel(fils, moneySpec)}</ThemedText>;
}

/** The small plain label over a card's headline: what the card shows. */
function CardLabel({ text, palette }: { text: string; palette: BandPalette }) {
  return <ThemedText type="small" style={{ color: palette.onBandSecondary }}>{text}</ThemedText>;
}

/** A count in a stat tile: Geist SemiBold, tabular digits. */
function CountTile({ label, value, palette, stacked, testID }: {
  label: string; value: number | string; palette: BandPalette; stacked: boolean; testID?: string;
}) {
  return <StatTile palette={palette} label={label} testID={testID} accessibilityLabel={`${label}, ${value}`}
    style={stacked && styles.tileStacked}>
    <ThemedText maxFontSizeMultiplier={STORY_TITLE_SMALL_MAX} numberOfLines={2}
      style={[styles.tileCount, { color: palette.onBand }]}>{value}</ThemedText>
  </StatTile>;
}

/** An amount in a stat tile, fitted to the tile's width. */
function MoneyTile({ label, fils, meta, moneySpec, palette, stacked, testID }: {
  label: string; fils: number; meta?: string; moneySpec: LedgerMoneySpec; palette: BandPalette; stacked: boolean; testID?: string;
}) {
  const { width } = useWindowDimensions();
  // BandFigure fits to (width - 40 - fitInset): leave it one tile's inner width.
  const tileInner = stacked ? width - BAND_GUTTER * 2 - 28 : (width - BAND_GUTTER * 2 - 10) / 2 - 28;
  return <StatTile palette={palette} label={label} meta={meta} testID={testID} style={stacked && styles.tileStacked}
    accessibilityLabel={[label, moneyLabel(fils, moneySpec), meta].filter(Boolean).join(', ')}>
    <BandFigure fils={fils} moneySpec={moneySpec} palette={palette} size="medium" fitInset={Math.max(0, width - 40 - tileInner)} />
  </StatTile>;
}

function TileRow({ children, stacked, testID }: { children: React.ReactNode; stacked: boolean; testID?: string }) {
  return <View testID={testID} style={[styles.tileRow, stacked && styles.tileRowStacked]}>{children}</View>;
}

function CoverScene({ snapshot, moneySpec, palette, w, compact, name }: SceneProps & { name: string | null }) {
  const enter = useRecapEntering();
  const large = useLargeTextLayout();
  const change = snapshot.spendChangePercent;
  const descriptor = snapshot.descriptor;
  const previousLabel = descriptor.kind === 'month'
    ? monthLabel(shiftMonthKey(descriptor.key, -1))
    : String(descriptor.year - 1);
  // The comparison is only there when the previous period had spending.
  const line = change === null ? w.spent
    : change === 0 ? w.spentSame(previousLabel)
      : change < 0 ? w.spentLess(Math.abs(change), previousLabel)
        : w.spentMore(change, previousLabel);
  return <View testID="recap-cover" style={styles.scene}>
    <YourPattern tile={compact || large ? 24 : 32} gap={4} testID="recap-cover-pattern" />
    <View style={styles.heading}>
      <ThemedText accessibilityRole="header" maxFontSizeMultiplier={STORY_TITLE_SMALL_MAX}
        style={[styles.coverTitle, { color: palette.onBand }]}>{w.coverTitle(name, descriptor.label)}</ThemedText>
      <ThemedText type="meta" style={{ color: palette.onBandSecondary }}>{shortDate(snapshot.from)} — {shortDate(snapshot.to)}</ThemedText>
    </View>
    <Animated.View entering={enter(FadeInUp.delay(100).duration(420))} style={styles.coverFigure}>
      <BandFigure testID="recap-spend-total" fils={snapshot.totalSpendFils} moneySpec={moneySpec} palette={palette} size="hero" />
      <ThemedText testID={change !== null ? 'recap-spend-change' : undefined} maxFontSizeMultiplier={STORY_TITLE_SMALL_MAX}
        style={[styles.coverLine, compact && styles.coverLineCompact, { color: palette.onBand }]}>{line}</ThemedText>
    </Animated.View>
    <View style={[styles.tiles, styles.pushBottom]}>
      <TileRow stacked={large} testID="recap-spend-counts">
        <CountTile palette={palette} stacked={large} label={w.payments} value={snapshot.spendingCount} />
        <CountTile palette={palette} stacked={large} label={w.merchants} value={snapshot.merchantCount} />
      </TileRow>
      <TileRow stacked={large} testID="recap-money-in-net">
        <MoneyTile palette={palette} moneySpec={moneySpec} stacked={large} label={w.moneyIn} fils={snapshot.totalIncomeFils} />
        <MoneyTile palette={palette} moneySpec={moneySpec} stacked={large} label={w.net} fils={snapshot.netFils} />
      </TileRow>
    </View>
  </View>;
}

/** Four time-of-day bars. Counts, never money; payments without a clock time are left out. */
function TimeOfDay({ snapshot, palette, w, compact }: Omit<SceneProps, 'moneySpec'>) {
  const large = useLargeTextLayout();
  const barHeight = large ? 88 : compact ? 110 : 150;
  const max = Math.max(1, ...RECAP_TIME_BUCKETS.map((bucket) => snapshot.timeOfDay[bucket]));
  const leaders = RECAP_TIME_BUCKETS.filter((bucket) => snapshot.timeOfDay[bucket] === max);
  // A tie has no single "most"; the headline then says only what the bars show.
  const top = leaders.length === 1 ? leaders[0] : null;
  return <View testID="recap-time-of-day" style={styles.timeBlock}>
    <ThemedText accessibilityRole="header" maxFontSizeMultiplier={STORY_TITLE_SMALL_MAX}
      style={[styles.cardHeadline, { color: palette.onBand }]}>{top ? w.timeHeadline(w[top]) : w.timeTitle}</ThemedText>
    <View style={styles.timeBars}>
      {RECAP_TIME_BUCKETS.map((bucket, index) => {
        const count = snapshot.timeOfDay[bucket];
        const lead = count === max && count > 0;
        return <View key={bucket} testID={`recap-time-${bucket}`} style={styles.timeColumn} accessible accessibilityRole="image"
          accessibilityLabel={w.timeBar(w[bucket], count)}>
          <ThemedText type="meta" style={[styles.tabularSans, { color: lead ? palette.onBand : palette.onBandSecondary }]}>{count}</ThemedText>
          <View style={[styles.timeTrack, { height: barHeight }]}>
            <GrowBar axis="height" size={count > 0 ? Math.max(6, (count / max) * barHeight) : 3} delay={index * 50}
              style={[styles.timeBar, { backgroundColor: lead ? palette.accent : palette.bandMark }]} />
          </View>
          <ThemedText type="meta" numberOfLines={large ? 2 : 1} adjustsFontSizeToFit={!large} minimumFontScale={0.8}
            style={[styles.timeLabel, { color: lead ? palette.onBand : palette.onBandSecondary }]}>{w[bucket]}</ThemedText>
        </View>;
      })}
    </View>
    <ThemedText testID="recap-time-caption" type="meta" style={{ color: palette.onBandSecondary }}>
      {w.timedBase(snapshot.timedCount)}
    </ThemedText>
  </View>;
}

/** Where and when: the merchant most was spent at, then the time of day payments happened. */
function WhereWhenScene({ snapshot, moneySpec, palette, w, compact }: SceneProps) {
  const enter = useRecapEntering();
  const large = useLargeTextLayout();
  const top = snapshot.topMerchants[0];
  if (!top) return null;
  const timed = snapshot.timedCount > 0;
  const meta = `${w.paymentsCount(top.count)} · ${moneyLabel(top.spendFils, moneySpec)}`;
  return <View testID="recap-where-when" style={styles.scene}>
    <Animated.View testID="recap-top-merchant" entering={enter(FadeInUp.duration(420))} accessible accessibilityRole="text"
      accessibilityLabel={`${w.merchant}: ${top.title}. ${meta}`} style={styles.merchantFeature}>
      <View style={styles.merchantIdentity}>
        <MerchantAvatar title={top.title} category={top.category} size={compact || large ? 52 : 64} />
        <View style={styles.flex}>
          <CardLabel text={w.merchant} palette={palette} />
          <ThemedText maxFontSizeMultiplier={STORY_TITLE_SMALL_MAX} numberOfLines={2}
            style={[styles.cardTitle, { color: palette.onBand }]}>{top.title}</ThemedText>
        </View>
      </View>
      <ThemedText type="default" style={{ color: palette.onBand }}>{meta}</ThemedText>
    </Animated.View>
    {timed ? <TimeOfDay snapshot={snapshot} palette={palette} w={w} compact={compact} /> : null}
    {/* The runners-up stay while there is room; the time of day comes first. */}
    {!(timed && large) && snapshot.topMerchants.length > 1 ? <View testID="recap-runners-up" style={[styles.merchantList, styles.pushBottom]}>
      {snapshot.topMerchants.slice(1, 3).map((merchant, index) =>
        <Animated.View key={merchant.key} entering={enter(FadeInUp.delay(120 + index * 50).duration(320))}
          style={[styles.merchantRow, { borderTopColor: palette.bandRule }]}>
          <ThemedText type="smallBold" style={[styles.runnerRank, styles.tabularSans, { color: palette.onBandSecondary }]}>{index + 2}</ThemedText>
          <MerchantAvatar title={merchant.title} category={merchant.category} size={timed || compact ? 32 : 40} />
          <View style={styles.flex}>
            <ThemedText type="smallBold" numberOfLines={1} style={{ color: palette.onBand }}>{merchant.title}</ThemedText>
            <ThemedText type="meta" style={{ color: palette.onBandSecondary }}>{w.paymentsCount(merchant.count)}</ThemedText>
          </View>
          <MoneyText fils={merchant.spendFils} moneySpec={moneySpec} color={palette.onBand} />
        </Animated.View>)}
    </View> : null}
  </View>;
}

function CategoryScene({ snapshot, moneySpec, palette, w }: SceneProps) {
  const enter = useRecapEntering();
  const top = snapshot.topCategories[0];
  const rows = snapshot.topCategories;
  // Percents are of the whole period's spending; what the top five leave is drawn faint, not spread over them.
  const rest = Math.max(0, 100 - rows.reduce((sum, row) => sum + row.percent, 0));
  return <View testID="recap-categories" style={styles.scene}>
    <View style={styles.heading}>
      <CardLabel text={w.categories} palette={palette} />
      {top && <View style={styles.categoryHeadline}>
        <ThemedText maxFontSizeMultiplier={STORY_NUMERAL_MAX} style={[styles.categoryPercent, { color: palette.onBand }]}>{top.percent}%</ThemedText>
        <View style={styles.categoryHeadlineCopy}>
          <ThemedText maxFontSizeMultiplier={STORY_TITLE_SMALL_MAX} style={[styles.cardTitle, { color: palette.onBand }]}>{top.label}</ThemedText>
          <ThemedText type="meta" style={{ color: palette.onBandSecondary }}>{w.topCategory}</ThemedText>
        </View>
      </View>}
    </View>
    <Animated.View testID="recap-category-share" entering={enter(FadeInUp.delay(80).duration(420))} accessible accessibilityRole="image"
      accessibilityLabel={`${w.categoryShares}: ${rows.map((row) => `${row.label} ${row.percent}%`).join(', ')}`}
      style={styles.shareStack}>
      {rows.map((row, index) => <View key={row.category} style={[styles.shareSegment, {
        flex: Math.max(1, row.percent), backgroundColor: palette.onBand, opacity: RANK_OPACITY[index] ?? REST_OPACITY,
      }]} />)}
      {rest > 0 ? <View style={[styles.shareSegment, { flex: rest, backgroundColor: palette.onBand, opacity: REST_OPACITY }]} /> : null}
    </Animated.View>
    <View style={[styles.categoryList, styles.pushBottom]}>
      {rows.slice(0, 4).map((row, index) =>
        <Animated.View key={row.category} entering={enter(FadeInUp.delay(100 + index * 50).duration(320))}
          style={[styles.categoryRow, { borderTopColor: palette.bandRule }]}>
          <View style={[styles.rankSquare, { backgroundColor: palette.onBand, opacity: RANK_OPACITY[index] ?? REST_OPACITY }]} />
          <ThemedText type="smallBold" style={[styles.flex, { color: palette.onBand }]}>{row.label}</ThemedText>
          <ThemedText type="meta" tabular style={{ color: palette.onBandSecondary }}>{row.percent}%</ThemedText>
          <MoneyText fils={row.spendFils} moneySpec={moneySpec} color={palette.onBand} />
        </Animated.View>)}
    </View>
  </View>;
}

function AccountScene({ snapshot, moneySpec, palette, w, compact }: SceneProps) {
  const enter = useRecapEntering();
  const large = useLargeTextLayout();
  const row = snapshot.mostUsedAccount;
  if (!row) return null;
  const isCard = row.account.kind === 'card' || !!row.account.cardType;
  return <View testID="recap-account" style={styles.scene}>
    <Animated.View entering={enter(FadeInUp.duration(420))} style={styles.heading}>
      <CardLabel text={isCard ? w.account : w.accountFallback} palette={palette} />
      <BankAvatar account={row.account} size={compact || large ? 52 : 64} />
      <ThemedText maxFontSizeMultiplier={STORY_TITLE_SMALL_MAX} numberOfLines={2}
        style={[styles.cardTitle, { color: palette.onBand }]}>{row.label}</ThemedText>
      {row.account.last4 && <ThemedText type="meta" tabular style={{ color: palette.onBandSecondary }}>•••• {row.account.last4}</ThemedText>}
    </Animated.View>
    <TileRow stacked={large} testID="recap-account-tiles">
      <CountTile palette={palette} stacked={large} label={w.payments} value={row.count} />
      <MoneyTile palette={palette} moneySpec={moneySpec} stacked={large} label={w.spentLabel} fils={row.spendFils} />
    </TileRow>
  </View>;
}

function RhythmScene({ snapshot, moneySpec, palette, w }: SceneProps) {
  const enter = useRecapEntering();
  const large = useLargeTextLayout();
  const busiest = snapshot.busiestWeekday;
  const headline = busiest ? w.busiest(weekdayName(busiest.day)) : null;
  // The time-of-day card already names the busiest time when it is there.
  const showFavorite = snapshot.favoriteTime && !(snapshot.topMerchants.length > 0 && snapshot.timedCount > 0);
  return <View testID="recap-rhythm" style={styles.scene}>
    <View style={styles.heading}>
      <CardLabel text={w.rhythm} palette={palette} />
      {headline && <ThemedText accessibilityRole="header" maxFontSizeMultiplier={STORY_TITLE_SMALL_MAX}
        style={[styles.cardHeadline, { color: palette.onBand }]}>{headline}</ThemedText>}
    </View>
    <View testID="recap-weekdays" accessible accessibilityRole="image" accessibilityLabel={headline ? `${w.weekdays}: ${headline}` : w.weekdays}
      style={[styles.dayTape, large && styles.dayTapeWrap]}>
      {Array.from({ length: 7 }, (_, i) => {
        const active = busiest?.day === i;
        return <Animated.View key={i} entering={enter(FadeInUp.delay(i * 50).duration(320))}
          style={[styles.dayCell, large && styles.dayCellLarge, { backgroundColor: active ? palette.accent : palette.tile }]}>
          <ThemedText type={active ? 'smallBold' : 'meta'} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}
            style={{ color: active ? palette.onAccent : palette.onBandSecondary }}>{w.dayShort(i)}</ThemedText>
        </Animated.View>;
      })}
    </View>
    <View style={[styles.tiles, styles.pushBottom]}>
      <TileRow stacked={large}>
        <CountTile palette={palette} stacked={large} label={w.noSpend} value={snapshot.noSpendDays} />
        <MoneyTile palette={palette} moneySpec={moneySpec} stacked={large} label={w.average} fils={snapshot.averagePurchaseFils} />
      </TileRow>
      {showFavorite && snapshot.favoriteTime ? <CountTile testID="recap-favorite-time" palette={palette} stacked
        label={w.favoriteTime} value={w[snapshot.favoriteTime.bucket]} /> : null}
    </View>
  </View>;
}

function HighlightScene({ snapshot, moneySpec, palette, w, compact }: SceneProps) {
  const large = useLargeTextLayout();
  const enter = useRecapEntering();
  if (snapshot.descriptor.kind === 'year' && snapshot.monthlySeries.length) {
    const barHeight = large ? 96 : compact ? 120 : 154;
    const max = Math.max(1, ...snapshot.monthlySeries.map((m) => m.spendFils));
    const high = snapshot.monthlySeries.reduce((a, b) => b.spendFils > a.spendFils ? b : a);
    const nonZero = snapshot.monthlySeries.filter((m) => m.spendFils > 0);
    const low = nonZero.length ? nonZero.reduce((a, b) => b.spendFils < a.spendFils ? b : a) : null;
    return <View testID="recap-highlight" style={styles.scene}>
      <View style={styles.heading}>
        <CardLabel text={w.monthly} palette={palette} />
        <ThemedText accessibilityRole="header" maxFontSizeMultiplier={STORY_TITLE_SMALL_MAX}
          style={[styles.cardTitle, { color: palette.onBand }]}>{snapshot.descriptor.label}</ThemedText>
      </View>
      <View testID="recap-year-bars" accessible accessibilityRole="image"
        accessibilityLabel={`${w.monthly}: ${snapshot.monthlySeries.map((month) => `${month.label} ${moneyLabel(month.spendFils, moneySpec)}`).join(', ')}`}
        style={styles.yearBars}>
        {snapshot.monthlySeries.map((month, index) => <View key={month.key} style={styles.yearColumn}>
          <View style={[styles.yearBarTrack, { height: barHeight }]}>
            <GrowBar axis="height" delay={index * 50} size={month.spendFils > 0 ? Math.max(4, (month.spendFils / max) * barHeight) : 2}
              style={[styles.yearBar, { backgroundColor: month.key === high.key ? palette.accent : palette.bandMark }]} />
          </View>
          <ThemedText type="nano" style={{ color: month.key === high.key ? palette.onBand : palette.onBandSecondary }}>{month.label.slice(0, 1)}</ThemedText>
        </View>)}
      </View>
      <TileRow stacked={large}>
        <MoneyTile palette={palette} moneySpec={moneySpec} stacked={large} label={w.highest} meta={high.label} fils={high.spendFils} />
        {low ? <MoneyTile palette={palette} moneySpec={moneySpec} stacked={large} label={w.quietest} meta={low.label} fils={low.spendFils} /> : null}
      </TileRow>
    </View>;
  }
  const purchase = snapshot.largestPurchase;
  if (!purchase) return null;
  return <View testID="recap-highlight" style={styles.scene}>
    <CardLabel text={w.biggest} palette={palette} />
    <Animated.View entering={enter(FadeInUp.duration(420))} style={styles.bigPurchase}>
      <View style={styles.bigPurchaseTop}>
        <MerchantAvatar title={purchase.title} category={purchase.category} size={compact || large ? 56 : 72} />
        <ThemedText type="meta" style={{ color: palette.onBandSecondary }}>{shortDate(purchase.date)}</ThemedText>
      </View>
      <ThemedText maxFontSizeMultiplier={STORY_TITLE_MAX} numberOfLines={2}
        style={[styles.cardTitle, { color: palette.onBand }]}>{purchase.title}</ThemedText>
      <BandFigure fils={purchase.amountFils} moneySpec={moneySpec} palette={palette} size="hero" />
    </Animated.View>
  </View>;
}

function FinaleScene({ snapshot, moneySpec, palette, w, onDone }: SceneProps & { onDone: () => void }) {
  const enter = useRecapEntering();
  const facts: [string, string][] = [
    [w.spentLabel, moneyLabel(snapshot.totalSpendFils, moneySpec)],
    [w.payments, String(snapshot.spendingCount)],
    [w.merchants, String(snapshot.merchantCount)],
    [w.noSpend, String(snapshot.noSpendDays)],
  ];
  if (snapshot.topCategories[0]) facts.push([w.categories, snapshot.topCategories[0].label]);
  return <View testID="recap-final" style={styles.scene}>
    <View style={styles.heading}>
      <CardLabel text={w.finale} palette={palette} />
      <ThemedText accessibilityRole="header" maxFontSizeMultiplier={STORY_TITLE_MAX}
        style={[styles.coverTitleLarge, { color: palette.onBand }]}>{snapshot.descriptor.label}</ThemedText>
      <ThemedText type="meta" style={{ color: palette.onBandSecondary }}>{shortDate(snapshot.from)} — {shortDate(snapshot.to)}</ThemedText>
    </View>
    <Animated.View entering={enter(FadeInUp.delay(80).duration(420))} style={[styles.finalBoard, styles.pushBottom]}>
      {facts.map(([label, value], index) => <View key={label} accessible accessibilityRole="text" accessibilityLabel={`${label}, ${value}`}
        style={[styles.finalFact, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.bandRule }]}>
        <ThemedText type="meta" style={{ color: palette.onBandSecondary }}>{label}</ThemedText>
        <ThemedText type="smallBold" tabular style={[styles.finalValue, { color: palette.onBand }]}>{value}</ThemedText>
      </View>)}
    </Animated.View>
    <EButton testID="recap-done" palette={palette} label={w.done} onPress={onDone}
      color={{ fill: palette.onBand, text: palette.band }} />
  </View>;
}

export function RecapStory({ snapshot, moneySpec, name = null, onClose }: {
  snapshot: RecapSnapshot;
  moneySpec: LedgerMoneySpec;
  /** The person's own name for the cover; null when the ledger has none. */
  name?: string | null;
  onClose: () => void;
}) {
  const language = useLanguage();
  const w = recapWords(language);
  const scheme = useBandScheme();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const progress = useSharedValue(reducedMotion ? 1 : 0);
  const scenes = useMemo(() => recapScenes(snapshot), [snapshot]);
  const current = scenes[Math.min(index, scenes.length - 1)]!;
  const palette = bandPalette(RECAP_SCENE_BANDS[current], scheme);
  const compact = height < 740;

  const next = useCallback(() => {
    setDirection(1);
    setIndex((at) => at >= scenes.length - 1 ? at : at + 1);
  }, [scenes.length]);
  const previous = useCallback(() => {
    setDirection(-1);
    setIndex((at) => Math.max(0, at - 1));
  }, []);

  useEffect(() => {
    cancelAnimation(progress);
    progress.value = reducedMotion ? 1 : 0;
    if (reducedMotion || index >= scenes.length - 1) return;
    progress.value = withTiming(1, { duration: STORY_MS, easing: Easing.bezier(...EASE) }, (finished) => {
      if (finished) runOnJS(next)();
    });
    return () => cancelAnimation(progress);
  }, [index, next, progress, reducedMotion, scenes.length]);

  const activeProgress = useAnimatedStyle(() => ({ transform: [{ scaleX: progress.value }] }));
  // Bands never move: the colour cross-fades between cards (instant under Reduce Motion).
  const bandColor = palette.band;
  const bandStyle = useAnimatedStyle(() => ({
    backgroundColor: withTiming(bandColor, { duration: Motion.change }),
  }), [bandColor]);
  const navigate = (event: { nativeEvent: { locationX: number } }) => {
    void tapped();
    if (event.nativeEvent.locationX < width * 0.34) previous();
    else next();
  };
  const slideEntering = reducedMotion
    ? undefined
    : (direction > 0 ? FadeInRight : FadeInLeft).duration(260);

  const props: SceneProps = { snapshot, moneySpec, palette, w, compact };
  const scene = current === 'cover' ? <CoverScene {...props} name={name} />
    : current === 'where' ? <WhereWhenScene {...props} />
      : current === 'category' ? <CategoryScene {...props} />
        : current === 'account' ? <AccountScene {...props} />
          : current === 'rhythm' ? <RhythmScene {...props} />
            : current === 'highlight' ? <HighlightScene {...props} />
              : <FinaleScene {...props} onDone={onClose} />;

  return <Animated.View testID="recap-story" style={[styles.root, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 12) }, bandStyle]}>
    <StatusBar style={palette.statusBar} />
    <View style={styles.topChrome}>
      <View style={styles.progressRow} accessible={false}>
        {scenes.map((key, i) => <View key={key} style={[styles.progressTrack, { backgroundColor: palette.bandRule }]}>
          {i < index && <View style={[StyleSheet.absoluteFillObject, styles.progressFill, { backgroundColor: palette.onBand }]} />}
          {i === index && <Animated.View style={[StyleSheet.absoluteFillObject, styles.progressFill, {
            backgroundColor: palette.onBand,
            transformOrigin: isRTL() ? 'right center' : 'left center',
          }, activeProgress]} />}
        </View>)}
      </View>
      <View style={styles.closeRow}>
        <BandIconButton palette={palette} action={{ icon: 'close', label: w.close, onPress: onClose, testID: 'recap-close' }} />
      </View>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={w.position(index + 1, scenes.length)}
      onPress={navigate} style={styles.touchArea}>
      <Animated.View key={`${snapshot.descriptor.id}:${index}`} entering={slideEntering}
        style={[styles.slide, compact && styles.slideCompact]}>
        {scene}
      </Animated.View>
    </Pressable>
  </Animated.View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  topChrome: { paddingHorizontal: BAND_GUTTER, paddingTop: 8, gap: 8, zIndex: 3 },
  progressRow: { flexDirection: 'row', gap: 4, height: 3 },
  progressTrack: { flex: 1, height: 3, borderRadius: 2, overflow: 'hidden' },
  progressFill: { borderRadius: 2 },
  closeRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  touchArea: { flex: 1 },
  slide: { flex: 1, paddingHorizontal: BAND_GUTTER, paddingBottom: 16 },
  slideCompact: { paddingBottom: 8 },
  scene: { flex: 1, paddingTop: 4, paddingBottom: 8, gap: 22 },
  heading: { gap: 8 },
  pushBottom: { marginTop: 'auto' },
  flex: { flex: 1, minWidth: 0 },
  tabularSans: { fontVariant: ['tabular-nums'] },
  coverTitle: { fontFamily: Fonts.sansSemi, fontSize: 22, lineHeight: 28, letterSpacing: -0.4 },
  coverTitleLarge: { fontFamily: Fonts.sansSemi, fontSize: 40, lineHeight: 46, letterSpacing: -1.2 },
  coverFigure: { gap: 6 },
  coverLine: { fontFamily: Fonts.sansSemi, fontSize: 26, lineHeight: 31, letterSpacing: -0.6 },
  coverLineCompact: { fontSize: 22, lineHeight: 27 },
  cardTitle: { fontFamily: Fonts.sansSemi, fontSize: 30, lineHeight: 36, letterSpacing: -0.8 },
  cardHeadline: { fontFamily: Fonts.sansSemi, fontSize: 26, lineHeight: 31, letterSpacing: -0.6 },
  tiles: { gap: 10 },
  tileRow: { flexDirection: 'row', gap: 10 },
  tileRowStacked: { flexDirection: 'column' },
  tileStacked: { flex: 0, flexBasis: 'auto', flexGrow: 0, alignSelf: 'stretch' },
  tileCount: { fontFamily: Fonts.sansSemi, fontVariant: ['tabular-nums'], fontSize: 30, lineHeight: 36, letterSpacing: -0.8 },
  merchantFeature: { gap: 10 },
  merchantIdentity: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  merchantList: { gap: 0 },
  merchantRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 6 },
  runnerRank: { minWidth: 18 },
  timeBlock: { gap: 12 },
  timeBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  timeColumn: { flex: 1, alignItems: 'center', gap: 6, minWidth: 0 },
  timeTrack: { alignSelf: 'stretch', justifyContent: 'flex-end', alignItems: 'stretch' },
  timeBar: { borderRadius: 12 },
  timeLabel: { textAlign: 'center' },
  categoryHeadline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 14 },
  categoryHeadlineCopy: { flex: 1, minWidth: 140, gap: 3, paddingBottom: 4 },
  categoryPercent: { fontFamily: Fonts.sansSemi, fontVariant: ['tabular-nums'], fontSize: 60, lineHeight: 64, letterSpacing: -2 },
  shareStack: { height: 18, flexDirection: 'row', gap: 2, overflow: 'hidden', borderRadius: 6 },
  shareSegment: { minWidth: 2 },
  categoryList: { gap: 0 },
  categoryRow: { minHeight: 52, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 6 },
  rankSquare: { width: 12, height: 12, borderRadius: 3 },
  dayTape: { flexDirection: 'row', gap: 5 },
  dayTapeWrap: { flexWrap: 'wrap' },
  dayCell: { flex: 1, minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  dayCellLarge: { flexBasis: '22%', flexGrow: 1 },
  bigPurchase: { flex: 1, justifyContent: 'center', gap: 16, paddingBottom: 24 },
  bigPurchaseTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  yearBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  yearColumn: { flex: 1, alignItems: 'center', gap: 6 },
  yearBarTrack: { alignSelf: 'stretch', justifyContent: 'flex-end', alignItems: 'stretch' },
  yearBar: { borderRadius: 4 },
  finalBoard: { paddingVertical: 4 },
  finalFact: { minHeight: 52, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 8 },
  finalValue: { flexShrink: 1, textAlign: 'right' },
});
