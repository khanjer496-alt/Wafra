import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInUp,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { BankAvatar } from '@/components/ui/bank-avatar';
import { CategoryDonut, useCategoricalPalette } from '@/components/ui/charts';
import { Icon } from '@/components/ui/icon';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import { WafraMark } from '@/components/wafra-logo';
import { EASE, Fonts, Motion, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useLanguage } from '@/hooks/use-language';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/hooks/use-theme';
import { shortDate, weekdayName } from '@/lib/format';
import { formatMinorUnits, type LedgerMoneySpec } from '@/lib/ledger-money';
import { tapped } from '@/lib/haptics';
import { isRTL } from '@/lib/i18n';
import { recapCopy as copy } from '@/lib/recap-copy';
import type { RecapSnapshot } from '@/lib/recap';

const STORY_MS = 7_000;

/** Match Wafra's app-wide policy: screen readers suppress motion too. */
function useRecapEntering() {
  const reducedMotion = useReducedMotion();
  return <T,>(animation: T): T | undefined => reducedMotion ? undefined : animation;
}

function HeroMoney({ fils, moneySpec, color }: { fils: number; moneySpec: LedgerMoneySpec; color?: string }) {
  return <View style={styles.heroMoney} accessible accessibilityLabel={`${moneySpec.currency} ${formatMinorUnits(Math.abs(fils), moneySpec)}`}>
    <ThemedText type="meta" themeColor="textSecondary" style={styles.heroCurrency}>{moneySpec.currency}</ThemedText>
    <ThemedText tabular style={[styles.heroAmount, color ? { color } : undefined]}>
      {fils < 0 ? '−' : ''}{formatMinorUnits(Math.abs(fils), moneySpec)}
    </ThemedText>
  </View>;
}

function MoneyText({ fils, moneySpec }: { fils: number; moneySpec: LedgerMoneySpec }) {
  return <ThemedText type="smallBold" tabular>{moneySpec.currency} {formatMinorUnits(Math.abs(fils), moneySpec)}</ThemedText>;
}

function Rule({ color }: { color: string }) {
  return <View style={[styles.rule, { backgroundColor: color }]} />;
}

function BrandOrbit() {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const turn = useSharedValue(0);
  useEffect(() => {
    if (reducedMotion) return;
    turn.value = withRepeat(withTiming(1, { duration: 11_000, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(turn);
  }, [reducedMotion, turn]);
  const motion = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 360}deg` }] }));
  return <View style={styles.orbit}>
    <Animated.View style={[StyleSheet.absoluteFillObject, motion]}>
      <Svg width="100%" height="100%" viewBox="0 0 220 220">
        <Circle cx="110" cy="110" r="91" fill="none" stroke={theme.track} strokeWidth="1" />
        <Circle cx="110" cy="110" r="91" fill="none" stroke={theme.primary} strokeWidth="2.5"
          strokeDasharray="48 524" strokeLinecap="round" />
        <Circle cx="110" cy="110" r="74" fill="none" stroke={theme.cardBorderStrong} strokeWidth="1"
          strokeDasharray="3 8" />
      </Svg>
    </Animated.View>
    <WafraMark size={72} />
  </View>;
}

function LedgerBackdrop({ variant = 0 }: { variant?: number }) {
  const theme = useTheme();
  const dark = useColorScheme() === 'dark';
  const muted = dark ? '#FFFFFF' : '#16130F';
  const path = variant % 3 === 0
    ? 'M-20 180 C70 95 130 265 240 144 C300 82 345 110 430 58'
    : variant % 3 === 1
      ? 'M-30 82 C82 175 126 18 230 92 C310 148 356 108 430 166'
      : 'M-20 150 C64 35 150 220 226 110 C294 14 350 162 430 76';
  return <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
    <Svg width="100%" height="100%" viewBox="0 0 400 760" preserveAspectRatio="none">
      {[130, 250, 370, 490, 610].map((y) =>
        <Line key={y} x1="18" x2="382" y1={y} y2={y} stroke={muted} opacity={0.045} strokeWidth="1" />)}
      <Path d={path} fill="none" stroke={theme.primary} strokeWidth="1.5" opacity={0.16} />
      <Path d={path} fill="none" stroke={theme.primary} strokeWidth="8" opacity={0.025} />
      <Circle cx={variant % 2 ? 332 : 68} cy={variant % 2 ? 232 : 570} r="92" fill="none"
        stroke={theme.gold} strokeWidth="1" opacity={0.12} />
    </Svg>
  </View>;
}

function IntroScene({ snapshot }: { snapshot: RecapSnapshot }) {
  const language = useLanguage();
  const w = copy[language === 'ar' ? 'ar' : 'en'];
  const enter = useRecapEntering();
  return <View style={styles.sceneCentered}>
    <Animated.View entering={enter(FadeIn.duration(Motion.sectionEnter))}>
      <BrandOrbit />
    </Animated.View>
    <Animated.View entering={enter(FadeInUp.delay(100).duration(420))} style={styles.centerCopy}>
      <ThemedText type="micro" themeColor="textTertiary">{w.recap} · {snapshot.descriptor.label}</ThemedText>
      <ThemedText style={styles.storyTitle}>{snapshot.descriptor.kind === 'year' ? w.yearIntro : w.monthIntro}</ThemedText>
      <ThemedText type="default" themeColor="textSecondary" style={styles.centerBody}>{w.introBody}</ThemedText>
    </Animated.View>
  </View>;
}

function SpendScene({ snapshot, moneySpec }: { snapshot: RecapSnapshot; moneySpec: LedgerMoneySpec }) {
  const language = useLanguage();
  const w = copy[language === 'ar' ? 'ar' : 'en'];
  const theme = useTheme();
  const change = snapshot.spendChangePercent;
  const enter = useRecapEntering();
  return <View style={styles.sceneSpread}>
    <Animated.View entering={enter(FadeInDown.duration(380))} style={styles.sceneHeading}>
      <ThemedText type="micro" themeColor="textTertiary">{w.spent.toUpperCase()}</ThemedText>
      <HeroMoney fils={snapshot.totalSpendFils} moneySpec={moneySpec} />
      {change !== null && <View style={[styles.changeChip, { backgroundColor: change <= 0 ? theme.primarySoft : theme.expenseSoftBg }]}>
        <Icon name={change <= 0 ? 'arrow-down-right' : 'arrow-up-right'} size={15} color={change <= 0 ? theme.income : theme.expense} />
        <ThemedText type="meta" style={{ color: change <= 0 ? theme.income : theme.expense }}>
          {Math.abs(change)}% {change <= 0 ? w.less : w.more}
        </ThemedText>
      </View>}
    </Animated.View>
    <View style={styles.metricRail}>
      <Metric value={String(snapshot.spendingCount)} label={w.transactions} delay={80} />
      <Metric value={String(snapshot.merchantCount)} label={w.merchants} delay={140} />
      <Metric value={formatMinorUnits(snapshot.totalIncomeFils, moneySpec)} label={moneySpec.currency + ' in'} delay={200} />
    </View>
  </View>;
}

function Metric({ value, label, delay = 0 }: { value: string; label: string; delay?: number }) {
  const enter = useRecapEntering();
  return <Animated.View entering={enter(FadeInUp.delay(delay).duration(360))} style={styles.metric}>
    <ThemedText style={styles.metricValue} tabular>{value}</ThemedText>
    <ThemedText type="meta" themeColor="textSecondary">{label}</ThemedText>
  </Animated.View>;
}

function CategoryScene({ snapshot, moneySpec }: { snapshot: RecapSnapshot; moneySpec: LedgerMoneySpec }) {
  const language = useLanguage();
  const w = copy[language === 'ar' ? 'ar' : 'en'];
  const palette = useCategoricalPalette();
  const enter = useRecapEntering();
  const slices = snapshot.topCategories.map((row, i) => ({
    key: row.category,
    label: row.label,
    value: row.spendFils,
    color: palette[i % palette.length],
  }));
  return <View style={styles.sceneSpread}>
    <View style={styles.sceneHeading}>
      <ThemedText type="micro" themeColor="textTertiary">{w.categories}</ThemedText>
      {snapshot.topCategories[0] && <ThemedText style={styles.storyTitleSmall}>
        {snapshot.topCategories[0].label} <ThemedText themeColor="textSecondary">{w.topCategory}</ThemedText>
      </ThemedText>}
    </View>
    <Animated.View entering={enter(FadeIn.delay(80).duration(480))} style={styles.donutRow}>
      <CategoryDonut slices={slices} size={190} thickness={18}
        centerLabel={snapshot.topCategories[0] ? `${snapshot.topCategories[0].percent}%` : '—'} />
    </Animated.View>
    <View style={styles.categoryList}>
      {snapshot.topCategories.slice(0, 4).map((row, index) =>
        <Animated.View key={row.category} entering={enter(FadeInUp.delay(100 + index * 45).duration(320))} style={styles.categoryRow}>
          <View style={[styles.swatch, { backgroundColor: palette[index % palette.length] }]} />
          <ThemedText type="small" style={styles.flex}>{row.label}</ThemedText>
          <ThemedText type="meta" themeColor="textSecondary" tabular>{row.percent}%</ThemedText>
          <MoneyText fils={row.spendFils} moneySpec={moneySpec} />
        </Animated.View>)}
    </View>
  </View>;
}

function MerchantScene({ snapshot, moneySpec }: { snapshot: RecapSnapshot; moneySpec: LedgerMoneySpec }) {
  const language = useLanguage();
  const w = copy[language === 'ar' ? 'ar' : 'en'];
  const top = snapshot.topMerchants[0];
  const enter = useRecapEntering();
  if (!top) return null;
  return <View style={styles.sceneSpread}>
    <View style={styles.sceneHeading}><ThemedText type="micro" themeColor="textTertiary">{w.merchant}</ThemedText></View>
    <Animated.View entering={enter(FadeInUp.duration(430))} style={styles.merchantHero}>
      <MerchantAvatar title={top.title} category={top.category} size={88} />
      <ThemedText style={styles.storyTitle}>{top.title}</ThemedText>
      <MoneyText fils={top.spendFils} moneySpec={moneySpec} />
      <ThemedText type="meta" themeColor="textSecondary">{top.count} {w.visits}</ThemedText>
    </Animated.View>
    <View style={styles.merchantPodium}>
      {snapshot.topMerchants.slice(0, 3).map((merchant, index) =>
        <Animated.View key={merchant.key} entering={enter(FadeInUp.delay(120 + index * 70).duration(360))}
          style={[styles.merchantMini, index === 0 && styles.merchantMiniFirst]}>
          <ThemedText type="nano" themeColor="textTertiary">#{index + 1}</ThemedText>
          <MerchantAvatar title={merchant.title} category={merchant.category} size={46 + (index === 0 ? 8 : 0)} />
          <ThemedText type="meta" numberOfLines={1} style={styles.merchantMiniLabel}>{merchant.title}</ThemedText>
        </Animated.View>)}
    </View>
  </View>;
}

function AccountScene({ snapshot, moneySpec }: { snapshot: RecapSnapshot; moneySpec: LedgerMoneySpec }) {
  const language = useLanguage();
  const w = copy[language === 'ar' ? 'ar' : 'en'];
  const theme = useTheme();
  const row = snapshot.mostUsedAccount;
  const enter = useRecapEntering();
  if (!row) return null;
  const isCard = row.account.kind === 'card' || !!row.account.cardType;
  return <View style={styles.sceneSpread}>
    <View style={styles.sceneHeading}><ThemedText type="micro" themeColor="textTertiary">{isCard ? w.account : w.accountFallback}</ThemedText></View>
    <Animated.View entering={enter(FadeInUp.duration(460))}
      style={[styles.bankCard, { backgroundColor: theme.backgroundElement, borderColor: theme.cardBorderStrong }]}>
      <View style={styles.bankCardTop}>
        <BankAvatar account={row.account} size={50} />
        <WafraMark size={28} color={theme.textTertiary} />
      </View>
      <View style={styles.bankCardBottom}>
        <ThemedText type="smallBold" numberOfLines={2}>{row.label}</ThemedText>
        {row.account.last4 && <ThemedText type="meta" themeColor="textTertiary" tabular>•••• {row.account.last4}</ThemedText>}
      </View>
    </Animated.View>
    <View style={styles.metricRail}>
      <Metric value={String(row.count)} label={`${w.used} · ${w.visits}`} delay={100} />
      <View style={styles.metric}><MoneyText fils={row.spendFils} moneySpec={moneySpec} /><ThemedText type="meta" themeColor="textSecondary">{w.spent.toLowerCase()}</ThemedText></View>
    </View>
  </View>;
}

function RhythmScene({ snapshot, moneySpec }: { snapshot: RecapSnapshot; moneySpec: LedgerMoneySpec }) {
  const language = useLanguage();
  const w = copy[language === 'ar' ? 'ar' : 'en'];
  const theme = useTheme();
  const enter = useRecapEntering();
  return <View style={styles.sceneSpread}>
    <View style={styles.sceneHeading}><ThemedText type="micro" themeColor="textTertiary">{w.rhythm}</ThemedText>
      {snapshot.busiestWeekday && <ThemedText style={styles.storyTitleSmall}>{weekdayName(snapshot.busiestWeekday.day)} <ThemedText themeColor="textSecondary">{w.busiest}</ThemedText></ThemedText>}
    </View>
    <View style={styles.rhythmPicture}>
      <View style={styles.dayRings}>
        {Array.from({ length: 7 }, (_, i) => {
          const active = snapshot.busiestWeekday?.day === i;
          return <Animated.View key={i} entering={enter(FadeIn.delay(i * 45).duration(260))} style={styles.dayItem}>
            <View style={[styles.dayDot, { borderColor: active ? theme.primary : theme.cardBorderStrong,
              backgroundColor: active ? theme.primarySoft : 'transparent' }]} />
            <ThemedText type="nano" themeColor={active ? 'text' : 'textTertiary'}>{weekdayName(i).slice(0, 2)}</ThemedText>
          </Animated.View>;
        })}
      </View>
    </View>
    <View style={styles.metricGrid}>
      <View style={styles.metricGridItem}><ThemedText style={styles.metricValue} tabular>{snapshot.noSpendDays}</ThemedText><ThemedText type="meta" themeColor="textSecondary">{w.noSpend}</ThemedText></View>
      <View style={styles.metricGridItem}><MoneyText fils={snapshot.averagePurchaseFils} moneySpec={moneySpec} /><ThemedText type="meta" themeColor="textSecondary">{w.average}</ThemedText></View>
      {snapshot.favoriteTime && <View style={[styles.metricGridItem, styles.metricWide]}><Icon name="sun" size={20} color={theme.warning} />
        <ThemedText type="smallBold">{w[snapshot.favoriteTime.bucket]}</ThemedText><ThemedText type="meta" themeColor="textSecondary">{w.favoriteTime}</ThemedText></View>}
    </View>
  </View>;
}

function HighlightScene({ snapshot, moneySpec }: { snapshot: RecapSnapshot; moneySpec: LedgerMoneySpec }) {
  const language = useLanguage();
  const w = copy[language === 'ar' ? 'ar' : 'en'];
  const theme = useTheme();
  const enter = useRecapEntering();
  if (snapshot.descriptor.kind === 'year' && snapshot.monthlySeries.length) {
    const max = Math.max(1, ...snapshot.monthlySeries.map((m) => m.spendFils));
    const high = snapshot.monthlySeries.reduce((a, b) => b.spendFils > a.spendFils ? b : a);
    const nonZero = snapshot.monthlySeries.filter((m) => m.spendFils > 0);
    const low = nonZero.length ? nonZero.reduce((a, b) => b.spendFils < a.spendFils ? b : a) : null;
    return <View style={styles.sceneSpread}>
      <View style={styles.sceneHeading}><ThemedText type="micro" themeColor="textTertiary">{w.monthly}</ThemedText>
        <ThemedText style={styles.storyTitleSmall}>{snapshot.descriptor.label}</ThemedText></View>
      <View style={styles.yearBars}>
        {snapshot.monthlySeries.map((month, index) => <View key={month.key} style={styles.yearColumn}>
          <View style={styles.yearBarTrack}>
            <Animated.View entering={enter(FadeInUp.delay(index * 34).duration(360))}
              style={[styles.yearBar, { height: Math.max(4, (month.spendFils / max) * 154), backgroundColor: month.key === high.key ? theme.primary : theme.track }]} />
          </View>
          <ThemedText type="nano" themeColor={month.key === high.key ? 'text' : 'textTertiary'}>{month.label.slice(0, 1)}</ThemedText>
        </View>)}
      </View>
      <View style={styles.metricRail}>
        <View style={styles.metric}><ThemedText type="smallBold">{high.label}</ThemedText><ThemedText type="meta" themeColor="textSecondary">{w.highest}</ThemedText><MoneyText fils={high.spendFils} moneySpec={moneySpec} /></View>
        {low && <View style={styles.metric}><ThemedText type="smallBold">{low.label}</ThemedText><ThemedText type="meta" themeColor="textSecondary">{w.quietest}</ThemedText><MoneyText fils={low.spendFils} moneySpec={moneySpec} /></View>}
      </View>
    </View>;
  }
  const purchase = snapshot.largestPurchase;
  if (!purchase) return null;
  return <View style={styles.sceneSpread}>
    <View style={styles.sceneHeading}><ThemedText type="micro" themeColor="textTertiary">{w.biggest}</ThemedText></View>
    <Animated.View entering={enter(FadeInUp.duration(430))} style={styles.bigPurchase}>
      <MerchantAvatar title={purchase.title} category={purchase.category} size={72} />
      <ThemedText style={styles.storyTitle}>{purchase.title}</ThemedText>
      <HeroMoney fils={purchase.amountFils} moneySpec={moneySpec} />
      <ThemedText type="meta" themeColor="textSecondary">{shortDate(purchase.date)}</ThemedText>
    </Animated.View>
  </View>;
}

function FinaleScene({ snapshot, moneySpec, onDone }: { snapshot: RecapSnapshot; moneySpec: LedgerMoneySpec; onDone: () => void }) {
  const language = useLanguage();
  const w = copy[language === 'ar' ? 'ar' : 'en'];
  const theme = useTheme();
  const enter = useRecapEntering();
  return <View style={styles.sceneSpread}>
    <View style={styles.sceneHeading}>
      <ThemedText type="micro" themeColor="textTertiary">{w.finale}</ThemedText>
      <ThemedText style={styles.storyTitle}>{snapshot.descriptor.label}</ThemedText>
      <ThemedText type="default" themeColor="textSecondary">{w.wrapped}</ThemedText>
    </View>
    <Animated.View entering={enter(FadeInUp.delay(80).duration(420))} style={[styles.finalBoard, { borderColor: theme.cardBorderStrong }]}>
      <FinalFact label={w.spent} value={`${moneySpec.currency} ${formatMinorUnits(snapshot.totalSpendFils, moneySpec)}`} />
      <Rule color={theme.cardBorder} />
      <FinalFact label={w.transactions} value={String(snapshot.spendingCount)} />
      <Rule color={theme.cardBorder} />
      <FinalFact label={w.merchants} value={String(snapshot.merchantCount)} />
      <Rule color={theme.cardBorder} />
      <FinalFact label={w.noSpend} value={String(snapshot.noSpendDays)} />
      {snapshot.topCategories[0] && <><Rule color={theme.cardBorder} /><FinalFact label={w.categories} value={snapshot.topCategories[0].label} /></>}
    </Animated.View>
    <Pressable accessibilityRole="button" onPress={onDone} style={({ pressed }) => [styles.doneButton, { backgroundColor: theme.primary, opacity: pressed ? 0.82 : 1 }]}>
      <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>{w.done}</ThemedText>
    </Pressable>
  </View>;
}

function FinalFact({ label, value }: { label: string; value: string }) {
  return <View style={styles.finalFact}><ThemedText type="meta" themeColor="textSecondary">{label}</ThemedText><ThemedText type="smallBold" tabular>{value}</ThemedText></View>;
}

export function RecapStory({ snapshot, moneySpec, onClose }: { snapshot: RecapSnapshot; moneySpec: LedgerMoneySpec; onClose: () => void }) {
  const theme = useTheme();
  const language = useLanguage();
  const w = copy[language === 'ar' ? 'ar' : 'en'];
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const progress = useSharedValue(reducedMotion ? 1 : 0);
  const slides = useMemo(() => {
    const story = [
      <IntroScene key="intro" snapshot={snapshot} />,
      <SpendScene key="spend" snapshot={snapshot} moneySpec={moneySpec} />,
    ];
    if (snapshot.topCategories.length > 0) {
      story.push(<CategoryScene key="category" snapshot={snapshot} moneySpec={moneySpec} />);
    }
    if (snapshot.topMerchants.length > 0) {
      story.push(<MerchantScene key="merchant" snapshot={snapshot} moneySpec={moneySpec} />);
    }
    if (snapshot.mostUsedAccount) {
      story.push(<AccountScene key="account" snapshot={snapshot} moneySpec={moneySpec} />);
    }
    if (snapshot.spendingCount > 0) {
      story.push(<RhythmScene key="rhythm" snapshot={snapshot} moneySpec={moneySpec} />);
    }
    if (snapshot.descriptor.kind === 'year' || snapshot.largestPurchase) {
      story.push(<HighlightScene key="highlight" snapshot={snapshot} moneySpec={moneySpec} />);
    }
    story.push(<FinaleScene key="final" snapshot={snapshot} moneySpec={moneySpec} onDone={onClose} />);
    return story;
  }, [moneySpec, onClose, snapshot]);

  const next = useCallback(() => {
    setIndex((current) => current >= slides.length - 1 ? current : current + 1);
  }, [slides.length]);
  const previous = useCallback(() => setIndex((current) => Math.max(0, current - 1)), []);

  useEffect(() => {
    cancelAnimation(progress);
    progress.value = reducedMotion ? 1 : 0;
    if (reducedMotion || index >= slides.length - 1) return;
    progress.value = withTiming(1, { duration: STORY_MS, easing: Easing.bezier(...EASE) }, (finished) => {
      if (finished) runOnJS(next)();
    });
    return () => cancelAnimation(progress);
  }, [index, next, progress, reducedMotion, slides.length]);

  const activeProgress = useAnimatedStyle(() => ({ transform: [{ scaleX: progress.value }] }));
  const navigate = (event: { nativeEvent: { locationX: number } }) => {
    void tapped();
    if (event.nativeEvent.locationX < width * 0.34) previous();
    else next();
  };

  return <View style={[styles.root, { backgroundColor: theme.background, paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 12) }]}>
    <LedgerBackdrop variant={index} />
    <View style={styles.topChrome}>
      <View style={styles.progressRow} accessible={false}>
        {slides.map((_, i) => <View key={i} style={[styles.progressTrack, { backgroundColor: theme.track }]}>
          {i < index && <View style={[StyleSheet.absoluteFillObject, styles.progressFill, { backgroundColor: theme.primary }]} />}
          {i === index && <Animated.View style={[StyleSheet.absoluteFillObject, styles.progressFill, {
            backgroundColor: theme.primary,
            transformOrigin: isRTL() ? 'right center' : 'left center',
          }, activeProgress]} />}
        </View>)}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={w.close} hitSlop={8} onPress={onClose}
        style={({ pressed }) => [styles.close, { borderColor: theme.cardBorderStrong, opacity: pressed ? 0.6 : 1 }]}>
        <Icon name="close" size={20} color={theme.text} />
      </Pressable>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={`${w.recap}, ${index + 1} / ${slides.length}`}
      onPress={navigate} style={styles.touchArea}>
      <Animated.View key={`${snapshot.descriptor.id}:${index}`} entering={reducedMotion ? undefined : FadeIn.duration(240)} style={styles.slide}>
        {slides[index]}
      </Animated.View>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  topChrome: { paddingHorizontal: ScreenPadding, gap: Spacing.three, zIndex: 3 },
  progressRow: { flexDirection: 'row', gap: 5, height: 4 },
  progressTrack: { flex: 1, height: 2, borderRadius: 1, overflow: 'hidden' },
  progressFill: { borderRadius: 1 },
  close: { width: 44, height: 44, borderRadius: Radius.full, borderWidth: 1, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-end' },
  touchArea: { flex: 1 },
  slide: { flex: 1, paddingHorizontal: ScreenPadding, paddingBottom: Spacing.four },
  sceneCentered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.four, paddingBottom: 54 },
  sceneSpread: { flex: 1, justifyContent: 'space-between', paddingTop: Spacing.three, paddingBottom: Spacing.four, gap: Spacing.four },
  sceneHeading: { gap: Spacing.two },
  centerCopy: { alignItems: 'center', gap: Spacing.two, maxWidth: 340 },
  centerBody: { textAlign: 'center', maxWidth: 310 },
  storyTitle: { fontFamily: Fonts.sansSemi, fontSize: 38, lineHeight: 44, letterSpacing: -1.1 },
  storyTitleSmall: { fontFamily: Fonts.sansSemi, fontSize: 29, lineHeight: 36, letterSpacing: -0.7 },
  orbit: { width: 220, height: 220, alignItems: 'center', justifyContent: 'center' },
  heroMoney: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 },
  heroCurrency: { fontFamily: Fonts.sansMedium, fontSize: 14 },
  heroAmount: { fontFamily: Fonts.monoSemi, fontSize: 49, lineHeight: 56, letterSpacing: -1.3 },
  changeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 36, paddingHorizontal: 10, borderRadius: Radius.chip },
  metricRail: { flexDirection: 'row', gap: Spacing.three, flexWrap: 'wrap' },
  metric: { minWidth: 94, flexGrow: 1, gap: 5 },
  metricValue: { fontFamily: Fonts.monoSemi, fontSize: 28, lineHeight: 34, letterSpacing: -0.5 },
  donutRow: { alignItems: 'center', justifyContent: 'center' },
  categoryList: { gap: 0 },
  categoryRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 },
  swatch: { width: 8, height: 24, borderRadius: 2 },
  flex: { flex: 1, minWidth: 0 },
  merchantHero: { alignItems: 'center', justifyContent: 'center', gap: Spacing.two, flex: 1 },
  merchantPodium: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: Spacing.three },
  merchantMini: { flex: 1, maxWidth: 110, alignItems: 'center', gap: 6, minHeight: 100 },
  merchantMiniFirst: { paddingBottom: 16 },
  merchantMiniLabel: { maxWidth: 100, textAlign: 'center' },
  bankCard: { minHeight: 220, borderWidth: 1, borderRadius: Radius.sheet, padding: 22, justifyContent: 'space-between' },
  bankCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bankCardBottom: { gap: 6 },
  rhythmPicture: { paddingVertical: 12 },
  dayRings: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  dayItem: { alignItems: 'center', gap: 8, flex: 1 },
  dayDot: { width: 34, height: 34, borderRadius: 17, borderWidth: 1.5 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  metricGridItem: { flexGrow: 1, flexBasis: '40%', minHeight: 92, gap: 6, justifyContent: 'center' },
  metricWide: { flexBasis: '100%', flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  bigPurchase: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  yearBars: { height: 190, flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  yearColumn: { flex: 1, alignItems: 'center', gap: 6 },
  yearBarTrack: { height: 154, alignSelf: 'stretch', justifyContent: 'flex-end', alignItems: 'center' },
  yearBar: { width: '68%', maxWidth: 18, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  finalBoard: { borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 4 },
  finalFact: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rule: { height: StyleSheet.hairlineWidth, width: '100%' },
  doneButton: { minHeight: 52, borderRadius: Radius.control, alignItems: 'center', justifyContent: 'center' },
});
